export interface ProviderOptions {
  maxTokens?: number;
  model?: string;
  timeout?: number;
}

export interface Provider {
  readonly name: string;
  query(prompt: string): Promise<string>;
  queryRich(system: string | undefined, userPrompt: string): Promise<LlmResponse>;
  queryStream?(prompt: string): AsyncIterable<string>;
}

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
}

export interface LlmResponse {
  text: string;
  usage: TokenUsage;
}

export interface ClaudeCliOptions extends ProviderOptions {
  noConfig?: boolean;
}
