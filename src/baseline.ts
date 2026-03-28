import { readFile, writeFile, unlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { Finding, Severity, VectorReport } from "./vectors/types.ts";
import { findingId } from "./reporter.ts";
import { tokenize, jaccard } from "./util.ts";

export type BaselineEntry = {
  id: string;
  vectorName: string;
  file: string;
  line: number;
  title: string;
  severity: Severity;
  addedAt: string;
  reason?: string;
};

const DEFAULT_PATH = ".brunt-baseline.json";

export async function readBaseline(path?: string): Promise<BaselineEntry[]> {
  try {
    const raw = await readFile(path ?? DEFAULT_PATH, "utf-8");
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.filter(
      (e: unknown): e is BaselineEntry =>
        typeof e === "object" && e !== null && "id" in e && "file" in e && "title" in e
    );
  } catch {
    return [];
  }
}

export async function writeBaseline(entries: BaselineEntry[], path?: string): Promise<void> {
  const sorted = [...entries].sort((a, b) => a.id.localeCompare(b.id));
  await writeFile(path ?? DEFAULT_PATH, JSON.stringify(sorted, null, 2) + "\n", "utf-8");
}

export async function clearBaseline(path?: string): Promise<boolean> {
  try {
    await unlink(path ?? DEFAULT_PATH);
    return true;
  } catch {
    return false;
  }
}

export function buildBaselineEntries(vectorReports: VectorReport[]): BaselineEntry[] {
  const now = new Date().toISOString();
  const entries: BaselineEntry[] = [];

  for (const vr of vectorReports) {
    for (const f of vr.findings) {
      entries.push({
        id: findingId(vr.name, f),
        vectorName: vr.name,
        file: f.file,
        line: f.line,
        title: f.title,
        severity: f.severity,
        addedAt: now,
      });
    }
  }

  return entries;
}

function contentHash(vectorName: string, title: string): string {
  return createHash("sha256")
    .update(`${vectorName}:${title}`)
    .digest("hex")
    .slice(0, 12);
}

export function filterByBaseline(
  vectorReports: VectorReport[],
  baseline: BaselineEntry[]
): { filtered: VectorReport[]; suppressed: number } {
  const baselineIds = new Set(baseline.map((e) => e.id));

  const baselineByFile = new Map<string, BaselineEntry[]>();
  for (const e of baseline) {
    const arr = baselineByFile.get(e.file) ?? [];
    arr.push(e);
    baselineByFile.set(e.file, arr);
  }

  const baselineContentHashes = new Map<string, BaselineEntry>();
  for (const e of baseline) {
    baselineContentHashes.set(contentHash(e.vectorName, e.title), e);
  }

  let suppressed = 0;

  const filtered = vectorReports.map((vr) => {
    const kept: Finding[] = [];

    for (const f of vr.findings) {
      const id = findingId(vr.name, f);

      // Tier 1: Exact ID match
      if (baselineIds.has(id)) {
        suppressed++;
        continue;
      }

      // Tier 2: Fuzzy match (same file, close line, similar title)
      const fileEntries = baselineByFile.get(f.file) ?? [];
      const fuzzyMatch = fileEntries.find((e) => {
        if (e.vectorName !== vr.name) return false;
        if (Math.abs(e.line - f.line) > 10) return false;
        return jaccard(tokenize(e.title), tokenize(f.title)) > 0.5;
      });

      if (fuzzyMatch) {
        suppressed++;
        continue;
      }

      // Tier 3: File rename detection (same vector + title, different file)
      const ch = contentHash(vr.name, f.title);
      if (baselineContentHashes.has(ch)) {
        suppressed++;
        continue;
      }

      kept.push(f);
    }

    return { ...vr, findings: kept };
  });

  return { filtered, suppressed };
}
