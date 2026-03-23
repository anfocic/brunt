export interface Provider {
  name: string;
  query(prompt: string): Promise<string>;
}
