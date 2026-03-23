import type { Provider } from "./types.ts";

export class AnthropicProvider implements Provider {
  name = "anthropic";
  private apiKey: string;
  private model: string;

  constructor(model = "claude-sonnet-4-6-20250514") {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) {
      throw new Error("ANTHROPIC_API_KEY environment variable is required for the anthropic provider.");
    }
    this.apiKey = key;
    this.model = model;
  }

  async query(prompt: string): Promise<string> {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
      }),
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
  }
}
