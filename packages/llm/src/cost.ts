import type { TokenUsage } from "./types.js";

export function estimateCost(usage: TokenUsage, model: string): number {
  const [inputPrice, outputPrice] = modelPricing(model);
  return (
    (usage.input_tokens / 1_000_000) * inputPrice +
    (usage.output_tokens / 1_000_000) * outputPrice
  );
}

export function modelPricing(model: string): [input: number, output: number] {
  if (model.includes("opus")) return [15, 75];
  if (model.includes("sonnet")) return [3, 15];
  if (model.includes("haiku")) return [0.25, 1.25];
  if (model.includes("gpt-4o-mini")) return [0.15, 0.6];
  if (model.includes("gpt-4o")) return [2.5, 10];
  return [3, 15];
}
