import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import type { Severity } from "./vectors/types.js";

export type CustomVectorConfig = {
  name: string;
  description: string;
  prompt: string;
  severity?: Severity;
  include?: string[];
  exclude?: string[];
};

export type BruntConfig = {
  vectors?: CustomVectorConfig[];
};

const CONFIG_FILENAMES = [
  "brunt.config.yaml",
  "brunt.config.yml",
  ".brunt.config.yaml",
];

const VALID_SEVERITIES = new Set(["low", "medium", "high", "critical"]);
const BUILTIN_VECTORS = new Set(["correctness", "security"]);
const MIN_PROMPT_LENGTH = 20;

export async function loadConfig(configPath?: string): Promise<BruntConfig | null> {
  let filePath: string | undefined;

  if (configPath) {
    filePath = resolve(configPath);
  } else {
    for (const name of CONFIG_FILENAMES) {
      try {
        const candidate = resolve(name);
        await readFile(candidate, "utf-8");
        filePath = candidate;
        break;
      } catch {
        // try next
      }
    }
  }

  if (!filePath) return null;

  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch (err) {
    if (configPath) {
      throw new Error(`Config file not found: ${configPath}`);
    }
    return null;
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (err) {
    throw new Error(`Invalid YAML in ${filePath}: ${err instanceof Error ? err.message : err}`);
  }

  if (parsed === null || parsed === undefined) return null;
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Config must be an object in ${filePath}`);
  }

  const config = parsed as Record<string, unknown>;

  if (!config.vectors) return { vectors: [] };

  if (!Array.isArray(config.vectors)) {
    throw new Error(`"vectors" must be an array in ${filePath}`);
  }

  const vectors = validateVectors(config.vectors, filePath);
  return { vectors };
}

function validateVectors(raw: unknown[], filePath: string): CustomVectorConfig[] {
  const vectors: CustomVectorConfig[] = [];
  const seenNames = new Set<string>();

  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i] as Record<string, unknown>;
    const label = `vectors[${i}] in ${filePath}`;

    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new Error(`${label}: must be an object`);
    }

    // name
    if (!entry.name || typeof entry.name !== "string") {
      throw new Error(`${label}: "name" is required and must be a string`);
    }
    const name = entry.name.trim();
    if (name.includes(" ")) {
      throw new Error(`${label}: "name" must not contain spaces ("${name}")`);
    }
    if (BUILTIN_VECTORS.has(name)) {
      throw new Error(`${label}: "${name}" conflicts with a built-in vector`);
    }
    if (seenNames.has(name)) {
      throw new Error(`${label}: duplicate vector name "${name}"`);
    }
    seenNames.add(name);

    // description
    if (!entry.description || typeof entry.description !== "string") {
      throw new Error(`${label}: "description" is required and must be a string`);
    }

    // prompt
    if (!entry.prompt || typeof entry.prompt !== "string") {
      throw new Error(`${label}: "prompt" is required and must be a string`);
    }
    if (entry.prompt.length < MIN_PROMPT_LENGTH) {
      throw new Error(`${label}: "prompt" must be at least ${MIN_PROMPT_LENGTH} characters`);
    }

    // severity (optional)
    let severity: Severity | undefined;
    if (entry.severity !== undefined) {
      if (typeof entry.severity !== "string" || !VALID_SEVERITIES.has(entry.severity)) {
        throw new Error(`${label}: "severity" must be one of: low, medium, high, critical`);
      }
      severity = entry.severity as Severity;
    }

    // include (optional)
    let include: string[] | undefined;
    if (entry.include !== undefined) {
      if (!Array.isArray(entry.include) || !entry.include.every((v: unknown) => typeof v === "string")) {
        throw new Error(`${label}: "include" must be an array of strings`);
      }
      include = entry.include as string[];
    }

    // exclude (optional)
    let exclude: string[] | undefined;
    if (entry.exclude !== undefined) {
      if (!Array.isArray(entry.exclude) || !entry.exclude.every((v: unknown) => typeof v === "string")) {
        throw new Error(`${label}: "exclude" must be an array of strings`);
      }
      exclude = entry.exclude as string[];
    }

    vectors.push({ name, description: entry.description, prompt: entry.prompt, severity, include, exclude });
  }

  return vectors;
}
