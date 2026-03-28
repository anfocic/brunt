import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";

export type BruntConfig = {
  provider?: string;
  model?: string;
  format?: string;
  failOn?: string;
  vectors?: string[];
  noTests?: boolean;
  maxTokens?: number;
  diff?: string;
  concurrency?: number;
  sensitive?: {
    patterns?: string[];
    enabled?: boolean;
  };
};

const CONFIG_FILENAME = "brunt.config.yaml";

function parseYaml(text: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = text.split("\n");
  let currentKey: string | null = null;
  let currentArray: string[] | null = null;

  for (const raw of lines) {
    const stripped = raw.replace(/#.*$/, "");
    if (stripped.trim() === "") continue;

    const indent = raw.search(/\S/);

    if (indent >= 2 && currentKey && stripped.trim().startsWith("- ")) {
      if (!currentArray) currentArray = [];
      currentArray.push(stripped.trim().slice(2).trim());
      continue;
    }

    if (indent >= 2 && currentKey) {
      const nested = result[currentKey];
      const kvMatch = stripped.trim().match(/^([a-zA-Z_]\w*):\s*(.*)$/);
      if (kvMatch) {
        const obj = (typeof nested === "object" && nested !== null && !Array.isArray(nested)
          ? nested
          : {}) as Record<string, unknown>;
        obj[kvMatch[1]!] = castValue(kvMatch[2]!);
        result[currentKey] = obj;
      }
      continue;
    }

    if (currentKey && currentArray) {
      result[currentKey] = currentArray;
      currentArray = null;
    }

    const kvMatch = stripped.trim().match(/^([a-zA-Z_]\w*):\s*(.*)$/);
    if (!kvMatch) continue;

    const key = kvMatch[1]!;
    const value = kvMatch[2]!.trim();

    if (value === "") {
      currentKey = key;
      currentArray = null;
      result[key] = {};
      continue;
    }

    if (value.startsWith("[") && value.endsWith("]")) {
      result[key] = value
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      currentKey = null;
      continue;
    }

    result[key] = castValue(value);
    currentKey = null;
  }

  if (currentKey && currentArray) {
    result[currentKey] = currentArray;
  }

  return result;
}

function castValue(raw: string): string | boolean {
  const trimmed = raw.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  return trimmed.replace(/^(["'])(.+)\1$/, "$2");
}

function getGitRoot(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("git", ["rev-parse", "--show-toplevel"], (error, stdout) => {
      if (error) {
        resolve(null);
        return;
      }
      resolve((stdout ?? "").trim());
    });
  });
}

function findConfigFile(startDir: string, stopDir: string | null): string | null {
  let dir = startDir;
  while (true) {
    const candidate = join(dir, CONFIG_FILENAME);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    if (stopDir && dir === stopDir) break;
    dir = parent;
  }
  return null;
}

export async function loadConfig(cwd?: string): Promise<BruntConfig> {
  const start = cwd ?? process.cwd();
  const gitRoot = await getGitRoot();
  const configPath = findConfigFile(start, gitRoot);

  if (!configPath) return {};

  const raw = await readFile(configPath, "utf-8");
  const parsed = parseYaml(raw);
  return mapToConfig(parsed);
}

const VALID_PROVIDERS = new Set(["claude-cli", "anthropic", "ollama"]);
const VALID_FORMATS = new Set(["text", "json", "sarif"]);
const VALID_SEVERITIES = new Set(["low", "medium", "high", "critical"]);

function mapToConfig(raw: Record<string, unknown>): BruntConfig {
  const config: BruntConfig = {};

  if (typeof raw.provider === "string") {
    if (!VALID_PROVIDERS.has(raw.provider)) {
      throw new Error(`Invalid provider in config: "${raw.provider}". Use ${[...VALID_PROVIDERS].join(", ")}.`);
    }
    config.provider = raw.provider;
  }
  if (typeof raw.model === "string") config.model = raw.model;
  if (typeof raw.format === "string") {
    if (!VALID_FORMATS.has(raw.format)) {
      throw new Error(`Invalid format in config: "${raw.format}". Use ${[...VALID_FORMATS].join(", ")}.`);
    }
    config.format = raw.format;
  }
  if (typeof raw.failOn === "string") {
    if (!VALID_SEVERITIES.has(raw.failOn)) {
      throw new Error(`Invalid failOn in config: "${raw.failOn}". Use ${[...VALID_SEVERITIES].join(", ")}.`);
    }
    config.failOn = raw.failOn;
  }
  if (typeof raw.diff === "string") config.diff = raw.diff;
  if (typeof raw.noTests === "boolean") config.noTests = raw.noTests;
  if (raw.maxTokens !== undefined) {
    const n = parseInt(String(raw.maxTokens), 10);
    if (!isNaN(n) && n > 0) config.maxTokens = n;
  }
  if (raw.concurrency !== undefined) {
    const n = parseInt(String(raw.concurrency), 10);
    if (!isNaN(n)) config.concurrency = Math.min(Math.max(n, 1), 20);
  }

  if (Array.isArray(raw.vectors)) {
    config.vectors = raw.vectors.filter((v): v is string => typeof v === "string");
  }

  if (typeof raw.sensitive === "object" && raw.sensitive !== null) {
    const s = raw.sensitive as Record<string, unknown>;
    config.sensitive = {};
    if (typeof s.enabled === "boolean") config.sensitive.enabled = s.enabled;
    if (Array.isArray(s.patterns)) {
      config.sensitive.patterns = s.patterns.filter((p): p is string => typeof p === "string");
    }
  }

  return config;
}

export { parseYaml };
