import type { Provider, ProviderOptions, ClaudeCliOptions } from "./types.js";
import { AnthropicProvider } from "./anthropic.js";
import { ClaudeCliProvider } from "./claude-cli.js";
import { OllamaProvider } from "./ollama.js";
import { OpenAIProvider } from "./openai.js";

export type ProviderName = "claude-cli" | "anthropic" | "ollama" | "openai";

export function createProvider(name: ProviderName, options: ProviderOptions & ClaudeCliOptions = {}): Provider {
  switch (name) {
    case "claude-cli":
      return new ClaudeCliProvider(options);
    case "anthropic":
      return new AnthropicProvider(options);
    case "ollama":
      return new OllamaProvider(options);
    case "openai":
      return new OpenAIProvider(options);
    default:
      throw new Error(`Unknown provider: ${name}. Valid: claude-cli, anthropic, ollama, openai`);
  }
}
