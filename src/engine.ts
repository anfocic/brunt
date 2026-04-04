import type { DiffFile, VectorReport, Vector } from "./vectors/types.js";
import type { Provider } from "@packages/llm";
import { loadContext } from "./context.js";
import { sanitizeDiff } from "./sanitize.js";
import { injectCanary, verifyCanary, verifyCanaryWithLlm } from "./canary.js";
import { computeCacheKey, readCache, writeCache } from "./cache.js";
import { detectInjection } from "./injection.js";
import { detectSuspiciousSilence } from "./silence.js";
import { loadCrossReferences, type CrossRefMatch } from "./crossref.js";
import {
  loadIncrementalState,
  saveIncrementalState,
  isStateCompatible,
  partitionFiles,
  mergeFindings,
  buildState,
  INCREMENTAL_PATH,
} from "./incremental.js";

const API_CONCURRENCY = 5;
const BATCH_TOKEN_BUDGET = 4000; // max estimated tokens per batch
const SOLO_FILE_THRESHOLD = 2000; // files above this go alone
const VECTOR_TIMEOUT = 120_000; // 2 minutes per vector batch

async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < tasks.length) {
      const idx = nextIndex++;
      try {
        results[idx] = { status: "fulfilled", value: await tasks[idx]!() };
      } catch (reason) {
        results[idx] = { status: "rejected", reason };
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

function estimateFileTokens(file: DiffFile, context: Map<string, string>): number {
  let chars = 0;
  for (const hunk of file.hunks) {
    for (const line of hunk.added) chars += line.length;
    for (const line of hunk.removed) chars += line.length;
  }
  const ctx = context.get(file.path);
  if (ctx) chars += ctx.length;
  return Math.ceil(chars / 4);
}

export function batchFiles(
  files: DiffFile[],
  context: Map<string, string>
): DiffFile[][] {
  const batches: DiffFile[][] = [];
  let currentBatch: DiffFile[] = [];
  let currentTokens = 0;

  for (const file of files) {
    const tokens = estimateFileTokens(file, context);

    // Large files go solo
    if (tokens > SOLO_FILE_THRESHOLD) {
      if (currentBatch.length > 0) {
        batches.push(currentBatch);
        currentBatch = [];
        currentTokens = 0;
      }
      batches.push([file]);
      continue;
    }

    // Would this file overflow the current batch?
    if (currentTokens + tokens > BATCH_TOKEN_BUDGET && currentBatch.length > 0) {
      batches.push(currentBatch);
      currentBatch = [];
      currentTokens = 0;
    }

    currentBatch.push(file);
    currentTokens += tokens;
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}

type ScanInput = {
  files: DiffFile[];
  vectors: Vector[];
  provider: Provider;
  noCache?: boolean;
  providerName?: string;
  model?: string;
  packageRoot?: string;
  incremental?: boolean;
  incrementalPath?: string;
};

type ScanResult = {
  vectorReports: VectorReport[];
  canaryVerified: boolean;
  fromCache: boolean;
};

export type ProgressEvent =
  | { type: "cache-hit" }
  | { type: "injection-detected"; file: string; line: string }
  | { type: "vectors-start"; total: number }
  | { type: "vector-done"; name: string; count: number; duration: number }
  | { type: "vector-failed"; name: string; message: string }
  | { type: "canary-missed" }
  | { type: "canary-failed" }
  | { type: "suspicious-silence"; file: string }
  | { type: "incremental-hit"; unchanged: number; rescanning: number }
  | { type: "incremental-invalidated" };

type ProgressCallback = (event: ProgressEvent) => void;

export async function scanEngine(
  input: ScanInput,
  onProgress?: ProgressCallback
): Promise<ScanResult> {
  const { files, vectors, provider, noCache, providerName, model, packageRoot, incremental, incrementalPath } = input;
  const resolvedProvider = providerName ?? provider.name;

  const cacheKey = computeCacheKey(files, vectors, resolvedProvider, model);

  if (!noCache) {
    const cached = await readCache(cacheKey);
    if (cached) {
      onProgress?.({ type: "cache-hit" });
      return { vectorReports: cached, canaryVerified: true, fromCache: true };
    }
  }

  // Incremental: partition into changed/unchanged files
  let filesToScan = files;
  let carriedFindings: import("./incremental.js").PerFileFinding[] = [];
  let useIncremental = false;

  if (incremental) {
    const state = await loadIncrementalState(incrementalPath);
    if (state && isStateCompatible(state, resolvedProvider, model, vectors.map((v) => v.name))) {
      const partition = partitionFiles(files, state);
      if (partition.unchanged.length > 0) {
        onProgress?.({ type: "incremental-hit", unchanged: partition.unchanged.length, rescanning: partition.changed.length });
        filesToScan = partition.changed;
        carriedFindings = partition.carriedFindings;
        useIncremental = true;
      }
    } else if (state) {
      onProgress?.({ type: "incremental-invalidated" });
    }
  }

  // If incremental and ALL files unchanged, return carried findings directly
  if (useIncremental && filesToScan.length === 0) {
    const emptyReports: VectorReport[] = vectors.map((v) => ({ name: v.name, findings: [], duration: 0 }));
    const merged = mergeFindings(emptyReports, carriedFindings, files);

    if (incremental) {
      const state = buildState(resolvedProvider, model, vectors.map((v) => v.name), files, merged);
      await saveIncrementalState(state, incrementalPath);
    }

    if (!noCache) {
      await writeCache(cacheKey, merged);
    }

    return { vectorReports: merged, canaryVerified: true, fromCache: true };
  }

  const injectionWarnings = detectInjection(filesToScan);
  for (const w of injectionWarnings) {
    onProgress?.({ type: "injection-detected", file: w.file, line: w.line });
  }

  const sanitizedFiles = sanitizeDiff(filesToScan);
  const { files: filesWithCanary, canary } = injectCanary(sanitizedFiles);
  const context = await loadContext(filesToScan, packageRoot);
  const crossRefs = await loadCrossReferences(filesToScan, packageRoot);

  onProgress?.({ type: "vectors-start", total: vectors.length });

  const batches = batchFiles(filesWithCanary, context);

  const settled = await Promise.allSettled(
    vectors.map(async (vector) => {
      const start = performance.now();
      const concurrency = provider.name === "claude-cli" ? batches.length : API_CONCURRENCY;
      const tasks = batches.map((batch) => () => {
        const batchContext = new Map<string, string>();
        for (const file of batch) {
          const ctx = context.get(file.path);
          if (ctx) batchContext.set(file.path, ctx);
        }
        let timer: ReturnType<typeof setTimeout>;
        return Promise.race([
          vector.analyze(batch, batchContext, provider, crossRefs),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error(`Vector "${vector.name}" timed out`)), VECTOR_TIMEOUT);
          }),
        ]).finally(() => clearTimeout(timer));
      });
      const perBatchResults = await runWithConcurrency(tasks, concurrency);
      const findings = perBatchResults.flatMap((r) =>
        r.status === "fulfilled" ? r.value : []
      );
      const duration = Math.round(performance.now() - start);
      onProgress?.({ type: "vector-done", name: vector.name, count: findings.length, duration });
      return { name: vector.name, findings, duration };
    })
  );

  const vectorReports: VectorReport[] = [];
  for (let i = 0; i < settled.length; i++) {
    const result = settled[i]!;
    if (result.status === "fulfilled") {
      vectorReports.push(result.value);
    } else {
      onProgress?.({ type: "vector-failed", name: vectors[i]!.name, message: result.reason?.message ?? String(result.reason) });
      vectorReports.push({ name: vectors[i]!.name, findings: [], duration: 0 });
    }
  }

  const allRawFindings = vectorReports.flatMap((v) => v.findings);
  const canaryFound = verifyCanary(allRawFindings, canary);
  let canaryVerified = false;

  if (!canaryFound) {
    onProgress?.({ type: "canary-missed" });
  } else {
    const llmVerified = await verifyCanaryWithLlm(canary, allRawFindings, provider);
    canaryVerified = !!llmVerified;
    if (!llmVerified) {
      onProgress?.({ type: "canary-failed" });
    }
  }

  for (const vr of vectorReports) {
    vr.findings = vr.findings.filter(
      (f) => f.file !== canary.file && !f.title.includes(canary.keyword) && !f.description.includes(canary.keyword)
    );
  }

  // Merge with carried findings from incremental state
  const finalReports = useIncremental
    ? mergeFindings(vectorReports, carriedFindings, files)
    : vectorReports;

  const allFindings = finalReports.flatMap((v) => v.findings);
  const silentFiles = detectSuspiciousSilence(files, allFindings);
  for (const f of silentFiles) {
    onProgress?.({ type: "suspicious-silence", file: f });
  }

  if (!noCache) {
    await writeCache(cacheKey, finalReports);
  }

  // Save incremental state
  if (incremental) {
    const state = buildState(resolvedProvider, model, vectors.map((v) => v.name), files, finalReports);
    await saveIncrementalState(state, incrementalPath);
  }

  return { vectorReports: finalReports, canaryVerified, fromCache: false };
}
