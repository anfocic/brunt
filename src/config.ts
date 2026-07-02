import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";

export type CustomVectorDef = {
  name: string;
  description: string;
  prompt: string;
};

export type BruntSettings = {
  provider?: string;
  model?: string;
  format?: "text" | "json" | "sarif";
  failOn?: "low" | "medium" | "high" | "critical";
  scope?: string;
  maxTokens?: number;
  fixRetries?: number;
  fix?: boolean;
  verify?: boolean;
  noTests?: boolean;
  noCache?: boolean;
};

export type BruntConfig = {
  /** Custom vector definitions (object entries under `vectors`). */
  vectors?: CustomVectorDef[];
  /**
   * The explicit set of vectors to run, in order — every name listed under
   * `vectors`, whether a built-in name (string) or a custom def (object).
   * Undefined when no `vectors` key is present.
   */
  select?: string[];
  /** Run settings that mirror CLI flags. */
  settings?: BruntSettings;
};

const CONFIG_NAMES = ["brunt.config.yaml", "brunt.config.yml"];
const NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

const VALID_PROVIDERS = ["claude-cli", "anthropic", "ollama", "openai"];
const VALID_FORMATS = ["text", "json", "sarif"];
const VALID_SEVERITIES = ["low", "medium", "high", "critical"];

async function tryReadFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}

type ParsedVectors = { custom: CustomVectorDef[]; select: string[] };

function validateVectors(vectors: unknown): ParsedVectors {
  if (!Array.isArray(vectors)) {
    throw new Error('"vectors" must be an array.');
  }

  const seen = new Set<string>();
  const custom: CustomVectorDef[] = [];
  const select: string[] = [];

  for (let i = 0; i < vectors.length; i++) {
    const entry = vectors[i];
    const prefix = `Vector at index ${i}`;

    // A bare string selects a built-in (or elsewhere-defined) vector by name.
    if (typeof entry === "string") {
      if (!NAME_PATTERN.test(entry)) {
        throw new Error(`${prefix}: "${entry}" must be lowercase alphanumeric with hyphens.`);
      }
      if (seen.has(entry)) {
        throw new Error(`Duplicate custom vector name: "${entry}".`);
      }
      seen.add(entry);
      select.push(entry);
      continue;
    }

    if (!entry || typeof entry !== "object") {
      throw new Error(`${prefix}: must be a vector name (string) or an object with name/description/prompt.`);
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
    custom.push({ name, description, prompt });
    select.push(name);
  }

  return { custom, select };
}

function enumSetting<T extends string>(
  config: Record<string, unknown>,
  key: string,
  allowed: readonly string[]
): T | undefined {
  const value = config[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new Error(`"${key}" must be one of: ${allowed.join(", ")} (got ${JSON.stringify(value)}).`);
  }
  return value as T;
}

function boolSetting(config: Record<string, unknown>, key: string): boolean | undefined {
  const value = config[key];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new Error(`"${key}" must be a boolean (got ${JSON.stringify(value)}).`);
  }
  return value;
}

function intSetting(
  config: Record<string, unknown>,
  key: string,
  min: number,
  max: number
): number | undefined {
  const value = config[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`"${key}" must be an integer between ${min} and ${max} (got ${JSON.stringify(value)}).`);
  }
  return value;
}

function validateSettings(config: Record<string, unknown>): BruntSettings | undefined {
  const settings: BruntSettings = {};

  const provider = enumSetting<string>(config, "provider", VALID_PROVIDERS);
  if (provider !== undefined) settings.provider = provider;

  if (config.model !== undefined) {
    if (typeof config.model !== "string" || config.model.length === 0) {
      throw new Error('"model" must be a non-empty string.');
    }
    settings.model = config.model;
  }

  const format = enumSetting<"text" | "json" | "sarif">(config, "format", VALID_FORMATS);
  if (format !== undefined) settings.format = format;

  const failOn = enumSetting<"low" | "medium" | "high" | "critical">(config, "failOn", VALID_SEVERITIES);
  if (failOn !== undefined) settings.failOn = failOn;

  if (config.scope !== undefined) {
    if (typeof config.scope !== "string" || config.scope.length === 0) {
      throw new Error('"scope" must be a non-empty string.');
    }
    settings.scope = config.scope;
  }

  const maxTokens = intSetting(config, "maxTokens", 1, 1_000_000);
  if (maxTokens !== undefined) settings.maxTokens = maxTokens;

  const fixRetries = intSetting(config, "fixRetries", 1, 5);
  if (fixRetries !== undefined) settings.fixRetries = fixRetries;

  for (const key of ["fix", "verify", "noTests", "noCache"] as const) {
    const value = boolSetting(config, key);
    if (value !== undefined) settings[key] = value;
  }

  return Object.keys(settings).length > 0 ? settings : undefined;
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
    const { custom, select } = validateVectors(config.vectors);
    result.vectors = custom;
    result.select = select;
  }

  const settings = validateSettings(config);
  if (settings) result.settings = settings;

  return result;
}
