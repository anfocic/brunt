import type { Provider, ProviderOptions, LlmResponse } from "./types.js";

const DEFAULT_MODEL = "gpt-4o";
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_ENDPOINT = "https://api.openai.com/v1/chat/completions";
const MAX_RETRIES = 5;
const INITIAL_BACKOFF_MS = 1000;

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveEndpoint(): string {
  const base = process.env.OPENAI_BASE_URL;
  if (base) {
    const normalized = base.endsWith("/") ? base.slice(0, -1) : base;
    return `${normalized}/chat/completions`;
  }
  return DEFAULT_ENDPOINT;
}

export class OpenAIProvider implements Provider {
  readonly name = "openai";
  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly timeout: number;

  constructor(options: ProviderOptions = {}) {
    this.endpoint = resolveEndpoint();
    const isCustomEndpoint = this.endpoint !== DEFAULT_ENDPOINT;
    const key = process.env.OPENAI_API_KEY;
    if (!key && !isCustomEndpoint) {
      throw new Error(
        "OPENAI_API_KEY environment variable is required for the openai provider. " +
        "For local servers (LM Studio, llama.cpp, vLLM), set OPENAI_BASE_URL instead."
      );
    }
    this.apiKey = key ?? "not-needed";
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

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeout);

      try {
        const response = await fetch(this.endpoint, {
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
          signal: controller.signal,
        });

        if (response.status === 429) {
          if (attempt === MAX_RETRIES) {
            const text = await response.text();
            throw new Error(`OpenAI API error (429) after ${MAX_RETRIES} retries: ${text}`);
          }
          const retryAfter = response.headers.get("retry-after");
          const backoff = retryAfter
            ? parseInt(retryAfter, 10) * 1000
            : INITIAL_BACKOFF_MS * Math.pow(2, attempt);
          await sleep(backoff);
          continue;
        }

        let body: Record<string, unknown>;
        try {
          body = (await response.json()) as Record<string, unknown>;
        } catch {
          throw new Error(`OpenAI API ${response.status}: non-JSON response`);
        }

        if (response.status !== 200) {
          const err = body?.error as { message?: string } | undefined;
          const msg = err?.message || JSON.stringify(body).slice(0, 200);
          throw new Error(`OpenAI API ${response.status}: ${msg}`);
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
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") {
          throw new Error(`OpenAI API timed out after ${this.timeout / 1000}s`);
        }
        throw err;
      } finally {
        clearTimeout(timer);
      }
    }

    throw new Error(`OpenAI API failed after ${MAX_RETRIES} retries`);
  }
}
