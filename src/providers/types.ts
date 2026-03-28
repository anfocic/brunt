export interface ProviderOptions {
  maxTokens?: number;
  model?: string;
  timeout?: number; // ms
}

export interface Provider {
  name: string;
  query(prompt: string): Promise<string>;
}
