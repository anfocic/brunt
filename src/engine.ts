import type { DiffFile, VectorReport, Vector } from "./vectors/types.ts";
import type { Provider } from "./providers/types.ts";
import { loadContext } from "./context.ts";
import { sanitizeDiff } from "./sanitize.ts";
import { injectCanary, verifyCanary, verifyCanaryWithLlm } from "./canary.ts";
import { computeCacheKey, readCache, writeCache } from "./cache.ts";

export type ScanInput = {
  files: DiffFile[];
  vectors: Vector[];
  provider: Provider;
  noCache?: boolean;
  providerName?: string;
  model?: string;
};

export type ScanResult = {
  vectorReports: VectorReport[];
  canaryVerified: boolean;
  fromCache: boolean;
};

export type ProgressEvent =
  | { type: "cache-hit" }
  | { type: "vectors-start"; total: number }
  | { type: "vector-done"; name: string; count: number; duration: number }
  | { type: "vector-failed"; name: string; message: string }
  | { type: "canary-missed" }
  | { type: "canary-failed" };

export type ProgressCallback = (event: ProgressEvent) => void;

export async function scanEngine(
  input: ScanInput,
  onProgress?: ProgressCallback
): Promise<ScanResult> {
  const { files, vectors, provider, noCache, providerName, model } = input;

  const vectorNames = vectors.map((v) => v.name);
  const cacheKey = computeCacheKey(files, vectorNames, providerName ?? provider.name, model);

  if (!noCache) {
    const cached = await readCache(cacheKey);
    if (cached) {
      onProgress?.({ type: "cache-hit" });
      return { vectorReports: cached, canaryVerified: true, fromCache: true };
    }
  }

  const sanitizedFiles = sanitizeDiff(files);
  const { files: filesWithCanary, canary } = injectCanary(sanitizedFiles);
  const context = await loadContext(files);

  onProgress?.({ type: "vectors-start", total: vectors.length });

  const settled = await Promise.allSettled(
    vectors.map(async (vector) => {
      const start = performance.now();
      const findings = await vector.analyze(filesWithCanary, context, provider);
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

  if (!noCache) {
    await writeCache(cacheKey, vectorReports);
  }

  return { vectorReports, canaryVerified, fromCache: false };
}
