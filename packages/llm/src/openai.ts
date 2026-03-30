import type { Provider, ProviderOptions, LlmResponse } from "./types.js";

const DEFAULT_MODEL = "gpt-4o";
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TIMEOUT_MS = 60_000;
const ENDPOINT = "https://api.openai.com/v1/chat/completions";

export class OpenAIProvider implements Provider {
  readonly name = "openai";
  private readonly apiKey: string;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly timeout: number;

  constructor(options: ProviderOptions = {}) {
    const key = process.env.OPENAI_API_KEY;
    if (!key) {
      throw new Error("OPENAI_API_KEY environment variable is required for the openai provider.");
    }
    this.apiKey = key;
    this.model = options.model ?? DEFAULT_MODEL;
    this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;
  }

  async query(prompt: string): Promise<string> {
    const result = await this.queryRich(undefined, prompt);
    return result.text;
  }

  async queryRich(system: string | undefined, userPrompt: string): Promise<LlmResponse> {
    const messages: Array<{ role: string; content: string }> = [];
    if (system) messages.push({ role: "system", content: system });
    messages.push({ role: "user", content: userPrompt });

    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        max_tokens: this.maxTokens,
      }),
      signal: AbortSignal.timeout(this.timeout),
    });

    let body: Record<string, unknown>;
    try {
      body = (await response.json()) as Record<string, unknown>;
    } catch {
      throw new Error(`openai api ${response.status}: non-JSON response`);
    }

    if (response.status !== 200) {
      const err = body?.error as { message?: string } | undefined;
      const msg = err?.message || JSON.stringify(body).slice(0, 200);
      throw new Error(`openai api ${response.status}: ${msg}`);
    }

    const choices = body.choices as Array<{ message?: { content?: string } }> | undefined;
    const usage = body.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;

    return {
      text: choices?.[0]?.message?.content ?? "",
      usage: {
        input_tokens: usage?.prompt_tokens ?? 0,
        output_tokens: usage?.completion_tokens ?? 0,
      },
    };
  }
}
