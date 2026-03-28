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

export type ProgressCallback = (event: string, detail?: string) => void;

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
      onProgress?.("cache-hit");
      return { vectorReports: cached, canaryVerified: true, fromCache: true };
    }
  }

  const sanitizedFiles = sanitizeDiff(files);
  const { files: filesWithCanary, canary } = injectCanary(sanitizedFiles);
  const context = await loadContext(files);

  onProgress?.("vectors-start", `${vectors.length}`);

  const settled = await Promise.allSettled(
    vectors.map(async (vector) => {
      const start = performance.now();
      const findings = await vector.analyze(filesWithCanary, context, provider);
      const duration = Math.round(performance.now() - start);
      onProgress?.("vector-done", `${vector.name}:${findings.length}:${duration}`);
      return { name: vector.name, findings, duration };
    })
  );

  const vectorReports: VectorReport[] = [];
  for (let i = 0; i < settled.length; i++) {
    const result = settled[i]!;
    if (result.status === "fulfilled") {
      vectorReports.push(result.value);
    } else {
      onProgress?.("vector-failed", `${vectors[i]!.name}:${result.reason?.message ?? String(result.reason)}`);
      vectorReports.push({ name: vectors[i]!.name, findings: [], duration: 0 });
    }
  }

  const allRawFindings = vectorReports.flatMap((v) => v.findings);
  const canaryFound = verifyCanary(allRawFindings, canary);
  let canaryVerified = false;

  if (!canaryFound) {
    onProgress?.("canary-missed");
  } else {
    const llmVerified = await verifyCanaryWithLlm(canary, allRawFindings, provider);
    canaryVerified = !!llmVerified;
    if (!llmVerified) {
      onProgress?.("canary-failed");
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
