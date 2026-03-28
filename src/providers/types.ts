export interface ProviderOptions {
  maxTokens?: number;
  model?: string;
  timeout?: number; // ms
}

export interface Provider {
  name: string;
  query(prompt: string): Promise<string>;
  queryStream?(prompt: string): AsyncIterable<string>;
}

export async function consumeStream(stream: AsyncIterable<string>): Promise<string> {
  let result = "";
  for await (const chunk of stream) result += chunk;
  return result;
}
