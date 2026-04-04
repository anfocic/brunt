import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";

export type CustomVectorDef = {
  name: string;
  description: string;
  prompt: string;
};

export type BruntConfig = {
  vectors?: CustomVectorDef[];
};

const CONFIG_NAMES = ["brunt.config.yaml", "brunt.config.yml"];
const NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

async function tryReadFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}

function validateVectors(vectors: unknown): CustomVectorDef[] {
  if (!Array.isArray(vectors)) {
    throw new Error('"vectors" must be an array.');
  }

  const seen = new Set<string>();
  const result: CustomVectorDef[] = [];

  for (let i = 0; i < vectors.length; i++) {
    const entry = vectors[i];
    const prefix = `Vector at index ${i}`;

    if (!entry || typeof entry !== "object") {
      throw new Error(`${prefix}: must be an object.`);
    }

    const { name, description, prompt } = entry as Record<string, unknown>;

    if (typeof name !== "string" || name.length === 0) {
      throw new Error(`${prefix}: "name" must be a non-empty string.`);
    }
    if (!NAME_PATTERN.test(name)) {
      throw new Error(`${prefix}: "name" must be lowercase alphanumeric with hyphens (got "${name}").`);
    }
    if (typeof description !== "string" || description.length === 0) {
      throw new Error(`${prefix}: "description" must be a non-empty string.`);
    }
    if (typeof prompt !== "string" || prompt.length === 0) {
      throw new Error(`${prefix}: "prompt" must be a non-empty string.`);
    }
    if (seen.has(name)) {
      throw new Error(`Duplicate custom vector name: "${name}".`);
    }

    seen.add(name);
    result.push({ name, description, prompt });
  }

  return result;
}

export async function loadConfig(explicitPath?: string): Promise<BruntConfig> {
  let raw: string | null = null;

  if (explicitPath) {
    raw = await tryReadFile(explicitPath);
    if (raw === null) {
      throw new Error(`Config file not found: ${explicitPath}`);
    }
  } else {
    for (const name of CONFIG_NAMES) {
      raw = await tryReadFile(name);
      if (raw !== null) break;
    }
  }

  if (raw === null) return {};

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (err) {
    throw new Error(`Failed to parse config: ${err instanceof Error ? err.message : err}`);
  }

  if (!parsed || typeof parsed !== "object") return {};

  const config = parsed as Record<string, unknown>;
  const result: BruntConfig = {};

  if (config.vectors !== undefined) {
    result.vectors = validateVectors(config.vectors);
  }

  return result;
}
