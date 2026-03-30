import type { Provider, ProviderOptions, LlmResponse } from "./types.js";

const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_MODEL = "claude-sonnet-4-6";
const DEFAULT_MAX_TOKENS = 16384;
const ENDPOINT = "https://api.anthropic.com/v1/messages";
const MAX_RETRIES = 5;
const INITIAL_BACKOFF_MS = 1000;

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class AnthropicProvider implements Provider {
  readonly name = "anthropic";
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeout: number;
  private readonly maxTokens: number;

  constructor(options: ProviderOptions = {}) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) {
      throw new Error("ANTHROPIC_API_KEY environment variable is required for the anthropic provider.");
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
    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: this.maxTokens,
      messages: [{ role: "user", content: userPrompt }],
    };
    if (system) body.system = system;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeout);

      try {
        const response = await fetch(ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": this.apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (response.status === 429 || response.status === 529) {
          clearTimeout(timer);
          if (attempt === MAX_RETRIES) {
            const text = await response.text();
            throw new Error(`Anthropic API error (${response.status}) after ${MAX_RETRIES} retries: ${text}`);
          }
          const retryAfter = response.headers.get("retry-after");
          const backoff = retryAfter
            ? parseInt(retryAfter, 10) * 1000
            : INITIAL_BACKOFF_MS * Math.pow(2, attempt);
          await sleep(backoff);
          continue;
        }

        if (!response.ok) {
          const text = await response.text();
          throw new Error(`Anthropic API error (${response.status}): ${text}`);
        }

        const data = (await response.json()) as {
          content?: Array<{ type: string; text?: string }>;
          usage?: { input_tokens?: number; output_tokens?: number };
        };

        const text = data.content?.find((c) => c.type === "text")?.text ?? "";

        return {
          text,
          usage: {
            input_tokens: data.usage?.input_tokens ?? 0,
            output_tokens: data.usage?.output_tokens ?? 0,
          },
        };
      } catch (err: unknown) {
        clearTimeout(timer);
        if (err instanceof Error && err.name === "AbortError") {
          throw new Error(`Anthropic API timed out after ${this.timeout / 1000}s`);
        }
        throw err;
      } finally {
        clearTimeout(timer);
      }
    }

    throw new Error("Unreachable: retry loop exhausted without throwing");
  }

  async *queryStream(prompt: string): AsyncIterable<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: this.maxTokens,
          messages: [{ role: "user", content: prompt }],
          stream: true,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Anthropic API error (${response.status}): ${body}`);
      }

      if (!response.body) throw new Error("No response body for streaming.");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);
          if (data === "[DONE]") return;

          try {
            const event = JSON.parse(data);
            if (event.type === "content_block_delta" && event.delta?.text) {
              yield event.delta.text;
            }
          } catch {}
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error(`Anthropic API timed out after ${this.timeout / 1000}s`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}
