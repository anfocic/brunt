import { createHash, randomBytes } from "node:crypto";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { join } from "node:path";
import type { DiffFile } from "./diff.js";
import type { VectorReport, Vector } from "./vectors/types.js";

const CACHE_DIR = ".brunt-cache";
const CACHE_VERSION = 2;

type CacheEntry = {
  version: number;
  key: string;
  timestamp: number;
  vectorReports: VectorReport[];
};

export function computeCacheKey(
  files: DiffFile[],
  vectors: Vector[],
  provider: string,
  model?: string
): string {
  const hash = createHash("sha256");
  hash.update(`v${CACHE_VERSION}`);
  hash.update(provider);
  hash.update(model ?? "");
  for (const v of [...vectors].sort((a, b) => a.name.localeCompare(b.name))) {
    hash.update(v.name);
    hash.update(v.promptHash ?? v.name);
  }

  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  for (const file of sorted) {
    hash.update(file.path);
    hash.update(file.language);
    for (const hunk of file.hunks) {
      hash.update(hunk.added.join("\n"));
      hash.update(hunk.removed.join("\n"));
    }
  }

  return hash.digest("hex").slice(0, 24);
}

export async function readCache(key: string): Promise<VectorReport[] | null> {
  try {
    const path = join(CACHE_DIR, `${key}.json`);
    const raw = await readFile(path, "utf-8");
    const entry = JSON.parse(raw) as CacheEntry;

    if (entry.version !== CACHE_VERSION || entry.key !== key) {
      return null;
    }

    return entry.vectorReports;
  } catch {
    return null;
  }
}

export async function writeCache(
  key: string,
  vectorReports: VectorReport[]
): Promise<void> {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    const entry: CacheEntry = {
      version: CACHE_VERSION,
      key,
      timestamp: Date.now(),
      vectorReports,
    };
    const target = join(CACHE_DIR, `${key}.json`);
    const tmp = join(CACHE_DIR, `${key}.${randomBytes(4).toString("hex")}.tmp`);
    await writeFile(tmp, JSON.stringify(entry), "utf-8");
    await rename(tmp, target);
  } catch {
    // Cache write failure is non-fatal
  }
}
