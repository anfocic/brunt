export interface ProviderOptions {
  maxTokens?: number;
  model?: string;
}

export interface Provider {
  name: string;
  query(prompt: string): Promise<string>;
}
