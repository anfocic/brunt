import { createHash, randomBytes } from "node:crypto";
import { readFile, writeFile, rename } from "node:fs/promises";
import type { DiffFile } from "./diff.js";
import type { Finding, VectorReport } from "./vectors/types.js";

export const INCREMENTAL_PATH = ".brunt-incremental.json";
const STATE_VERSION = 1;

export type PerFileFinding = {
  vector: string;
  finding: Finding;
};

export type IncrementalFileEntry = {
  contentHash: string;
  findings: PerFileFinding[];
  scannedAt: string;
};

export type IncrementalState = {
  version: number;
  provider: string;
  model?: string;
  vectors: string[];
  files: Record<string, IncrementalFileEntry>;
  updatedAt: string;
};

export function computeFileHash(file: DiffFile): string {
  const hash = createHash("sha256");
  hash.update(file.path);
  hash.update(file.language);
  for (const hunk of file.hunks) {
    hash.update(hunk.added.join("\n"));
    hash.update(hunk.removed.join("\n"));
  }
  return hash.digest("hex").slice(0, 24);
}

export async function loadIncrementalState(
  path = INCREMENTAL_PATH
): Promise<IncrementalState | null> {
  try {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw) as IncrementalState;
    if (parsed.version !== STATE_VERSION) return null;
    if (!parsed.files || typeof parsed.files !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function saveIncrementalState(
  state: IncrementalState,
  path = INCREMENTAL_PATH
): Promise<void> {
  try {
    // Atomic write: write to temp file then rename to prevent corruption from concurrent scans
    const tmpPath = `${path}.${randomBytes(4).toString("hex")}.tmp`;
    await writeFile(tmpPath, JSON.stringify(state, null, 2), "utf-8");
    await rename(tmpPath, path);
  } catch {
    // Non-fatal — incremental state write failure shouldn't break the scan
  }
}

export function isStateCompatible(
  state: IncrementalState,
  provider: string,
  model: string | undefined,
  vectorNames: string[]
): boolean {
  if (state.provider !== provider) return false;
  if ((state.model ?? "") !== (model ?? "")) return false;
  const sorted = [...vectorNames].sort();
  if (state.vectors.length !== sorted.length) return false;
  return state.vectors.every((v, i) => v === sorted[i]);
}

export type PartitionResult = {
  changed: DiffFile[];
  unchanged: DiffFile[];
  carriedFindings: PerFileFinding[];
};

export function partitionFiles(
  files: DiffFile[],
  state: IncrementalState
): PartitionResult {
  const changed: DiffFile[] = [];
  const unchanged: DiffFile[] = [];
  const carriedFindings: PerFileFinding[] = [];

  for (const file of files) {
    const hash = computeFileHash(file);
    const entry = state.files[file.path];

    if (entry && entry.contentHash === hash) {
      unchanged.push(file);
      carriedFindings.push(...entry.findings);
    } else {
      changed.push(file);
    }
  }

  return { changed, unchanged, carriedFindings };
}

export function mergeFindings(
  newReports: VectorReport[],
  carriedFindings: PerFileFinding[],
  currentFiles: DiffFile[]
): VectorReport[] {
  // Only include carried findings for files still in the diff
  const currentPaths = new Set(currentFiles.map((f) => f.path));
  const dropped = carriedFindings.filter((pf) => !currentPaths.has(pf.finding.file));
  if (dropped.length > 0) {
    const files = [...new Set(dropped.map((pf) => pf.finding.file))];
    console.error(`Note: ${dropped.length} finding(s) dropped — file(s) no longer in diff: ${files.join(", ")}`);
  }
  const validCarried = carriedFindings.filter((pf) =>
    currentPaths.has(pf.finding.file)
  );

  // Group carried findings by vector name
  const carriedByVector = new Map<string, Finding[]>();
  for (const pf of validCarried) {
    if (!carriedByVector.has(pf.vector)) {
      carriedByVector.set(pf.vector, []);
    }
    carriedByVector.get(pf.vector)!.push(pf.finding);
  }

  // Merge into new reports
  return newReports.map((report) => {
    const carried = carriedByVector.get(report.name) ?? [];
    return {
      name: report.name,
      findings: [...carried, ...report.findings],
      duration: report.duration,
    };
  });
}

export function buildState(
  provider: string,
  model: string | undefined,
  vectorNames: string[],
  files: DiffFile[],
  mergedReports: VectorReport[]
): IncrementalState {
  // Index all findings by file and vector
  const findingsByFile = new Map<string, PerFileFinding[]>();
  for (const report of mergedReports) {
    for (const finding of report.findings) {
      if (!findingsByFile.has(finding.file)) {
        findingsByFile.set(finding.file, []);
      }
      findingsByFile.get(finding.file)!.push({
        vector: report.name,
        finding,
      });
    }
  }

  const fileEntries: Record<string, IncrementalFileEntry> = {};
  const now = new Date().toISOString();

  for (const file of files) {
    fileEntries[file.path] = {
      contentHash: computeFileHash(file),
      findings: findingsByFile.get(file.path) ?? [],
      scannedAt: now,
    };
  }

  return {
    version: STATE_VERSION,
    provider,
    model,
    vectors: [...vectorNames].sort(),
    files: fileEntries,
    updatedAt: now,
  };
}
