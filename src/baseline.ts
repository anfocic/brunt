import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import type { Finding, VectorReport, Severity } from "./vectors/types.js";

export const BASELINE_VERSION = 1;
export const BASELINE_PATH = ".brunt-baseline.json";

export type BaselineEntry = {
  fingerprint: string;
  vector: string;
  file: string;
  line: number;
  title: string;
  severity: Severity;
};

export type BaselineFile = {
  version: number;
  createdAt: string;
  entries: BaselineEntry[];
};

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

export function computeFingerprint(vector: string, f: Finding): string {
  return createHash("sha256")
    .update(`${vector}\0${f.file}\0${normalize(f.title)}`)
    .digest("hex")
    .slice(0, 16);
}

export async function loadBaseline(path?: string): Promise<BaselineFile | null> {
  try {
    const raw = await readFile(path ?? BASELINE_PATH, "utf-8");
    const data = JSON.parse(raw) as BaselineFile;
    if (data.version !== BASELINE_VERSION) {
      console.error(`Warning: baseline file version mismatch (got ${data.version}, expected ${BASELINE_VERSION}). Baseline suppression disabled.`);
      return null;
    }
    if (!Array.isArray(data.entries)) return null;
    return data;
  } catch {
    return null;
  }
}

export async function saveBaseline(entries: BaselineEntry[], path?: string): Promise<void> {
  const file: BaselineFile = {
    version: BASELINE_VERSION,
    createdAt: new Date().toISOString(),
    entries,
  };
  await writeFile(path ?? BASELINE_PATH, JSON.stringify(file, null, 2) + "\n", "utf-8");
}

export function filterBaselined(
  reports: VectorReport[],
  baseline: BaselineFile
): { filtered: VectorReport[]; suppressedCount: number } {
  const fingerprints = new Set(
    baseline.entries
      .filter((e) => /^[a-f0-9]+$/.test(e.fingerprint))
      .map((e) => e.fingerprint)
  );
  let suppressedCount = 0;

  const filtered = reports.map((vr) => {
    const kept = vr.findings.filter((f) => {
      const fp = computeFingerprint(vr.name, f);
      if (fingerprints.has(fp)) {
        suppressedCount++;
        return false;
      }
      return true;
    });
    return { name: vr.name, findings: kept, duration: vr.duration };
  });

  return { filtered, suppressedCount };
}
