import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { DiffFile } from "./diff.ts";
import type { VectorReport } from "./vectors/types.ts";

const CACHE_DIR = ".brunt-cache";
const CACHE_VERSION = 1;

type CacheEntry = {
  version: number;
  key: string;
  timestamp: number;
  vectorReports: VectorReport[];
};

export function computeCacheKey(
  files: DiffFile[],
  vectorNames: string[],
  provider: string,
  model?: string
): string {
  const hash = createHash("sha256");
  hash.update(`v${CACHE_VERSION}`);
  hash.update(provider);
  hash.update(model ?? "");
  hash.update(vectorNames.sort().join(","));

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
    await writeFile(
      join(CACHE_DIR, `${key}.json`),
      JSON.stringify(entry),
      "utf-8"
    );
  } catch {
    // Cache write failure is non-fatal
  }
}
