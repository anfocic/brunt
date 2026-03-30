import type { Provider, LlmResponse } from "./types.js";
import { createProvider, type ProviderName } from "./factory.js";

const DEFAULT_MODELS: Record<string, string> = {
  anthropic: "claude-sonnet-4-20250514",
  openai: "gpt-4o",
};

export class LlmClient {
  readonly displayName: string;
  private readonly provider: Provider;

  constructor(provider: Provider, displayName?: string) {
    this.provider = provider;
    this.displayName = displayName ?? provider.name;
  }

  static fromEnv(model?: string, providerName?: string): LlmClient | null {
    const name = (providerName || "anthropic") as ProviderName;

    const envKeys: Record<string, string> = {
      anthropic: "ANTHROPIC_API_KEY",
      openai: "OPENAI_API_KEY",
    };
    const requiredKey = envKeys[name];
    if (requiredKey && !process.env[requiredKey]) return null;

    const resolvedModel = model ?? DEFAULT_MODELS[name];
    const provider = createProvider(name, { model: resolvedModel });
    const display = `${name} (${resolvedModel ?? name})`;
    return new LlmClient(provider, display);
  }

  async query(system: string, userPrompt: string): Promise<LlmResponse> {
    return this.provider.queryRich(system, userPrompt);
  }
}
