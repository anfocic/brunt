import type { Provider, ProviderOptions } from "./types.ts";

const TIMEOUT_MS = 120_000; // 2 minutes
const DEFAULT_MODEL = "claude-sonnet-4-6-20250514";
const DEFAULT_MAX_TOKENS = 4096;

export class AnthropicProvider implements Provider {
  name = "anthropic";
  private apiKey: string;
  private model: string;
  private maxTokens: number;

  constructor(options: ProviderOptions = {}) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) {
      throw new Error("ANTHROPIC_API_KEY environment variable is required for the anthropic provider.");
    }
    this.apiKey = key;
    this.model = options.model ?? DEFAULT_MODEL;
    this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  }

  async query(prompt: string): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
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
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Anthropic API error (${response.status}): ${body}`);
      }

      const data = (await response.json()) as {
        content: Array<{ type: string; text: string }>;
      };

      const text = data.content.find((c) => c.type === "text")?.text;
      if (!text) {
        throw new Error("No text content in Anthropic API response.");
      }

      return text;
    } catch (err: any) {
      if (err?.name === "AbortError") {
        throw new Error(`Anthropic API timed out after ${TIMEOUT_MS / 1000}s`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}
