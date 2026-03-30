import type { DiffFile, VectorReport, Vector } from "./vectors/types.js";
import type { Provider } from "@packages/llm";
import { loadContext } from "./context.js";
import { sanitizeDiff } from "./sanitize.js";
import { injectCanary, verifyCanary, verifyCanaryWithLlm } from "./canary.js";
import { computeCacheKey, readCache, writeCache } from "./cache.js";
import { detectInjection } from "./injection.js";
import { detectSuspiciousSilence } from "./silence.js";

const API_CONCURRENCY = 5;

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

type ScanInput = {
  files: DiffFile[];
  vectors: Vector[];
  provider: Provider;
  noCache?: boolean;
  providerName?: string;
  model?: string;
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
  | { type: "suspicious-silence"; file: string };

type ProgressCallback = (event: ProgressEvent) => void;

export async function scanEngine(
  input: ScanInput,
  onProgress?: ProgressCallback
): Promise<ScanResult> {
  const { files, vectors, provider, noCache, providerName, model } = input;

  const cacheKey = computeCacheKey(files, vectors, providerName ?? provider.name, model);

  if (!noCache) {
    const cached = await readCache(cacheKey);
    if (cached) {
      onProgress?.({ type: "cache-hit" });
      return { vectorReports: cached, canaryVerified: true, fromCache: true };
    }
  }

  const injectionWarnings = detectInjection(files);
  for (const w of injectionWarnings) {
    onProgress?.({ type: "injection-detected", file: w.file, line: w.line });
  }

  const sanitizedFiles = sanitizeDiff(files);
  const { files: filesWithCanary, canary } = injectCanary(sanitizedFiles);
  const context = await loadContext(files);

  onProgress?.({ type: "vectors-start", total: vectors.length });

  const settled = await Promise.allSettled(
    vectors.map(async (vector) => {
      const start = performance.now();
      const concurrency = provider.name === "claude-cli" ? filesWithCanary.length : API_CONCURRENCY;
      const tasks = filesWithCanary.map((file) => () => {
        const fileContext = new Map<string, string>();
        const ctx = context.get(file.path);
        if (ctx) fileContext.set(file.path, ctx);
        return vector.analyze([file], fileContext, provider);
      });
      const perFileResults = await runWithConcurrency(tasks, concurrency);
      const findings = perFileResults.flatMap((r) =>
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

  const allFindings = vectorReports.flatMap((v) => v.findings);
  const silentFiles = detectSuspiciousSilence(files, allFindings);
  for (const f of silentFiles) {
    onProgress?.({ type: "suspicious-silence", file: f });
  }

  if (!noCache) {
    await writeCache(cacheKey, vectorReports);
  }

  return { vectorReports, canaryVerified, fromCache: false };
}
