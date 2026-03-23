import type { Vector } from "./types.ts";
import { correctness } from "./correctness.ts";
import { security } from "./security.ts";

const ALL_VECTORS: Vector[] = [
  correctness,
  security,
  // future: performance, resilience, business-logic
];

const vectorMap = new Map(ALL_VECTORS.map((v) => [v.name, v]));

export function getVectors(names?: string[]): Vector[] {
  if (!names || names.length === 0) return ALL_VECTORS;

  return names.map((name) => {
    const vector = vectorMap.get(name);
    if (!vector) {
      const available = ALL_VECTORS.map((v) => v.name).join(", ");
      throw new Error(`Unknown vector: "${name}". Available: ${available}`);
    }
    return vector;
  });
}

export function listVectors(): Vector[] {
  return ALL_VECTORS;
}
