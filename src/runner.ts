import type { Args } from "./cli.ts";
import { getDiff } from "./diff.ts";
import { loadContext } from "./context.ts";
import { sanitizeDiff } from "./sanitize.ts";
import { injectCanary, verifyCanary, verifyCanaryWithLlm } from "./canary.ts";
import { getVectors } from "./vectors/registry.ts";
import type { VectorReport, ScanReport } from "./vectors/types.ts";
import { generateTests, writeTests } from "./proof/test-gen.ts";
import { formatText, formatJson, formatSarif, shouldFail } from "./reporter.ts";
import { ClaudeCliProvider } from "./providers/claude-cli.ts";
import { AnthropicProvider } from "./providers/anthropic.ts";
import { OllamaProvider } from "./providers/ollama.ts";
import type { Provider, ProviderOptions } from "./providers/types.ts";
import { checkGitRepo, checkProvider } from "./preflight.ts";
import { computeCacheKey, readCache, writeCache } from "./cache.ts";
import { postPrReview, getHeadSha } from "./github.ts";

function getProvider(name: string, options: ProviderOptions = {}): Provider {
  switch (name) {
    case "claude-cli":
      return new ClaudeCliProvider(options);
    case "anthropic":
      return new AnthropicProvider(options);
    case "ollama":
      return new OllamaProvider(options);
    default:
      throw new Error(`Unknown provider: ${name}`);
  }
}

export async function run(args: Args): Promise<number> {
  await checkGitRepo();
  await checkProvider(args.provider, args.model);

  const provider = getProvider(args.provider, {
    maxTokens: args.maxTokens,
    model: args.model,
  });
  const vectors = getVectors(args.vectors);
  const scanStart = performance.now();

  console.error("Parsing diff...");
  const files = await getDiff(args.diff, {
    enabled: args.sensitiveEnabled,
    patterns: args.sensitivePatterns,
  });

  if (files.length === 0) {
    console.error("No code changes found in diff.");
    return 0;
  }

  console.error(`Analyzing ${files.length} file${files.length === 1 ? "" : "s"}...`);

  const vectorNames = vectors.map((v) => v.name);
  const cacheKey = computeCacheKey(files, vectorNames, args.provider, args.model);
  let vectorReports: VectorReport[];
  let fromCache = false;

  if (!args.noCache) {
    const cached = await readCache(cacheKey);
    if (cached) {
      console.error("Cache hit — skipping LLM analysis.");
      vectorReports = cached;
      fromCache = true;
    }
  }

  if (!fromCache) {
    const sanitizedFiles = sanitizeDiff(files);
    const { files: filesWithCanary, canary } = injectCanary(sanitizedFiles);
    const context = await loadContext(files);

    console.error(`Running ${vectors.length} vector${vectors.length === 1 ? "" : "s"} via ${provider.name}...`);

    const settled = await Promise.allSettled(
      vectors.map(async (vector) => {
        const start = performance.now();
        const findings = await vector.analyze(filesWithCanary, context, provider);
        const duration = Math.round(performance.now() - start);
        console.error(`  ${vector.name}: ${findings.length} finding${findings.length === 1 ? "" : "s"} (${duration}ms)`);
        return { name: vector.name, findings, duration };
      })
    );

    vectorReports = [];
    for (let i = 0; i < settled.length; i++) {
      const result = settled[i]!;
      if (result.status === "fulfilled") {
        vectorReports.push(result.value);
      } else {
        console.error(`WARNING: Vector "${vectors[i]!.name}" failed: ${result.reason?.message ?? result.reason}`);
        vectorReports.push({ name: vectors[i]!.name, findings: [], duration: 0 });
      }
    }

    // Verify canary was detected
    const allRawFindings = vectorReports.flatMap((v) => v.findings);
    const canaryFound = verifyCanary(allRawFindings, canary);

    if (!canaryFound) {
      console.error("WARNING: Canary bug was not detected. Analysis may have been compromised by prompt injection.");
      console.error("         Results may be unreliable. Review the diff manually.");
    } else {
      const llmVerified = await verifyCanaryWithLlm(canary, allRawFindings, provider);
      if (!llmVerified) {
        console.error("WARNING: Canary two-pass verification failed. The canary match may be a false positive.");
        console.error("         Results may be unreliable. Review the diff manually.");
      }
    }

    // Strip canary findings from results
    for (const vr of vectorReports) {
      vr.findings = vr.findings.filter(
        (f) => f.file !== canary.file && !f.title.includes(canary.keyword) && !f.description.includes(canary.keyword)
      );
    }

    // Write to cache (after canary stripping so cache is clean)
    if (!args.noCache) {
      await writeCache(cacheKey, vectorReports);
    }
  }

  const report: ScanReport = {
    vectors: vectorReports,
    totalFindings: vectorReports.reduce((sum, v) => sum + v.findings.length, 0),
    totalDuration: Math.round(performance.now() - scanStart),
  };

  const allFindings = vectorReports.flatMap((v) => v.findings);
  let tests: Awaited<ReturnType<typeof generateTests>> = [];

  if (allFindings.length > 0 && !args.noTests) {
    console.error(`Found ${report.totalFindings} issue${report.totalFindings === 1 ? "" : "s"}. Generating proof tests...`);
    tests = await generateTests(allFindings, provider, args.concurrency ?? 3);
    await writeTests(tests);
  } else if (allFindings.length > 0) {
    console.error(`Found ${report.totalFindings} issue${report.totalFindings === 1 ? "" : "s"}.`);
  }

  const output =
    args.format === "json"
      ? formatJson(report, tests)
      : args.format === "sarif"
        ? formatSarif(report, tests)
        : formatText(report, tests);

  process.stdout.write(output + "\n");

  if (args.prComment) {
    try {
      const sha = await getHeadSha();
      await postPrReview(report.vectors, sha);
    } catch (err) {
      console.error(`WARNING: Failed to post PR comment: ${err instanceof Error ? err.message : err}`);
    }
  }

  return shouldFail(allFindings, args.failOn) ? 1 : 0;
}
