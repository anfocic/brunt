import type { Provider, ProviderOptions } from "./types.ts";

const DEFAULT_HOST = "http://localhost:11434";
const DEFAULT_MODEL = "llama3";
const TIMEOUT_MS = 300_000; // 5 minutes -- local models can be slow

export class OllamaProvider implements Provider {
  name = "ollama";
  private host: string;
  private model: string;
  private maxTokens: number;
  private timeout: number;

  constructor(options: ProviderOptions = {}) {
    this.host = process.env.OLLAMA_HOST ?? DEFAULT_HOST;
    this.model = options.model ?? process.env.OLLAMA_MODEL ?? DEFAULT_MODEL;
    this.maxTokens = options.maxTokens ?? 4096;
    this.timeout = options.timeout ?? TIMEOUT_MS;
  }

  async query(prompt: string): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.host}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          prompt,
          stream: false,
          options: {
            num_predict: this.maxTokens,
          },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Ollama API error (${response.status}): ${body}`);
      }

      const data = (await response.json()) as { response: string };
      if (!data.response) {
        throw new Error("No response content from Ollama API.");
      }

      return data.response;
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error(`Ollama timed out after ${this.timeout / 1000}s`);
      }
      if (
        err instanceof TypeError &&
        (err.message.includes("fetch") || err.message.includes("ECONNREFUSED"))
      ) {
        throw new Error(
          `Cannot connect to Ollama at ${this.host}. Is Ollama running? Start it with: ollama serve`
        );
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async *queryStream(prompt: string): AsyncIterable<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.host}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          prompt,
          stream: true,
          options: { num_predict: this.maxTokens },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Ollama API error (${response.status}): ${body}`);
      }

      if (!response.body) {
        throw new Error("No response body for streaming.");
      }

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
          if (!line.trim()) continue;
          try {
            const data = JSON.parse(line) as { response?: string; done?: boolean };
            if (data.response) yield data.response;
            if (data.done) return;
          } catch {}
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error(`Ollama timed out after ${this.timeout / 1000}s`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}
