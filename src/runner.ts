import type { Args } from "./cli.ts";
import { getDiff } from "./diff.ts";
import { loadContext } from "./context.ts";
import { sanitizeDiff } from "./sanitize.ts";
import { injectCanary, verifyCanary, verifyCanaryWithLlm } from "./canary.ts";
import { getVectors } from "./vectors/registry.ts";
import type { VectorReport, ScanReport } from "./vectors/types.ts";
import { generateTests, writeTests } from "./proof/test-gen.ts";
import { formatText, formatJson, formatSarif, formatConsensus, shouldFail } from "./reporter.ts";
import { ClaudeCliProvider } from "./providers/claude-cli.ts";
import { AnthropicProvider } from "./providers/anthropic.ts";
import { OllamaProvider } from "./providers/ollama.ts";
import type { Provider, ProviderOptions } from "./providers/types.ts";
import { checkGitRepo, checkProvider } from "./preflight.ts";
import { computeCacheKey, readCache, writeCache } from "./cache.ts";
import { postPrReview, getHeadSha } from "./github.ts";
import { fixAll, type FixVerification } from "./fix/fix-gen.ts";
import { createFixPr } from "./fix/pr.ts";
import { Spinner, ProgressBoard, printBanner } from "./tui.ts";
import { runInteractive } from "./interactive.ts";
import { buildConsensus, type ConsensusReport } from "./consensus.ts";

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
  printBanner();
  await checkGitRepo();
  await checkProvider(args.provider, args.model);

  const provider = getProvider(args.provider, {
    maxTokens: args.maxTokens,
    model: args.model,
  });
  const vectors = getVectors(args.vectors);
  const scanStart = performance.now();

  const spinner = new Spinner("Parsing diff...");
  spinner.start();

  const files = await getDiff(args.diff, {
    enabled: args.sensitiveEnabled,
    patterns: args.sensitivePatterns,
  });

  if (files.length === 0) {
    spinner.succeed("No code changes found in diff.");
    return 0;
  }

  spinner.succeed(`Parsed ${files.length} file${files.length === 1 ? "" : "s"}.`);

  const vectorNames = vectors.map((v) => v.name);
  const cacheKey = computeCacheKey(files, vectorNames, args.provider, args.model);
  let vectorReports: VectorReport[];
  let fromCache = false;

  if (!args.noCache) {
    const cached = await readCache(cacheKey);
    if (cached) {
      spinner.start("Cache hit — skipping LLM analysis.");
      spinner.succeed("Cache hit — loaded previous results.");
      vectorReports = cached;
      fromCache = true;
    }
  }

  if (!fromCache) {
    const sanitizedFiles = sanitizeDiff(files);
    const { files: filesWithCanary, canary } = injectCanary(sanitizedFiles);
    const context = await loadContext(files);

    const board = new ProgressBoard(vectors.map((v) => v.name));
    process.stderr.write(`\n  Running ${vectors.length} vector${vectors.length === 1 ? "" : "s"} via ${provider.name}:\n\n`);
    for (const v of vectors) {
      board.update(v.name, "running");
    }

    const settled = await Promise.allSettled(
      vectors.map(async (vector) => {
        const start = performance.now();
        const findings = await vector.analyze(filesWithCanary, context, provider);
        const duration = Math.round(performance.now() - start);
        const detail = `${findings.length} finding${findings.length === 1 ? "" : "s"}`;
        board.update(vector.name, "done", detail, duration);
        return { name: vector.name, findings, duration };
      })
    );

    board.finish();

    vectorReports = [];
    for (let i = 0; i < settled.length; i++) {
      const result = settled[i]!;
      if (result.status === "fulfilled") {
        vectorReports.push(result.value);
      } else {
        board.update(vectors[i]!.name, "failed", result.reason?.message ?? String(result.reason));
        console.error(`WARNING: Vector "${vectors[i]!.name}" failed: ${result.reason?.message ?? result.reason}`);
        vectorReports.push({ name: vectors[i]!.name, findings: [], duration: 0 });
      }
    }

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

    for (const vr of vectorReports) {
      vr.findings = vr.findings.filter(
        (f) => f.file !== canary.file && !f.title.includes(canary.keyword) && !f.description.includes(canary.keyword)
      );
    }

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
  let fixes: FixVerification[] = [];

  if (allFindings.length > 0 && !args.noTests) {
    const testSpinner = new Spinner(`Generating proof tests for ${report.totalFindings} issue${report.totalFindings === 1 ? "" : "s"}...`);
    testSpinner.start();
    tests = await generateTests(allFindings, provider, args.concurrency ?? 3);
    await writeTests(tests);
    testSpinner.succeed(`Generated ${tests.length} proof test${tests.length === 1 ? "" : "s"}.`);
  } else if (allFindings.length > 0) {
    const noIssueSpinner = new Spinner("");
    noIssueSpinner.succeed(`Found ${report.totalFindings} issue${report.totalFindings === 1 ? "" : "s"}.`);
  }

  if (args.fix && args.noTests) {
    console.error("WARNING: --fix requires test generation. Use without --no-tests.");
  } else if (args.fix && tests.length > 0) {
    const fixSpinner = new Spinner(`Generating fixes and verifying (${tests.length} finding${tests.length === 1 ? "" : "s"})...`);
    fixSpinner.start();
    fixes = await fixAll(allFindings, tests, provider, args.concurrency ?? 3, args.fixRetries);
    const verified = fixes.filter((f) => f.status === "verified").length;
    const failed = fixes.filter((f) => f.status === "failed").length;
    if (verified > 0) {
      fixSpinner.succeed(`Verified ${verified} fix${verified === 1 ? "" : "es"}${failed > 0 ? `, ${failed} failed` : ""}.`);
    } else if (failed > 0) {
      fixSpinner.fail(`${failed} fix${failed === 1 ? "" : "es"} failed verification.`);
    } else {
      fixSpinner.succeed("No fixable findings.");
    }
  }

  process.stderr.write("\n");

  const output =
    args.format === "json"
      ? formatJson(report, tests, fixes)
      : args.format === "sarif"
        ? formatSarif(report, tests)
        : formatText(report, tests, fixes);

  process.stdout.write(output + "\n");

  if (args.consensus && allFindings.length > 0) {
    await runConsensus(args, files, vectors, vectorReports);
  }

  if (args.pr && fixes.length > 0) {
    const verifiedFixes = fixes.filter((f) => f.status === "verified");
    if (verifiedFixes.length > 0) {
      const prSpinner = new Spinner("Creating PR with fixes...");
      prSpinner.start();
      try {
        const prUrl = await createFixPr(verifiedFixes);
        prSpinner.succeed(`PR created: ${prUrl}`);
      } catch (err) {
        prSpinner.fail(`Failed to create PR: ${err instanceof Error ? err.message : err}`);
      }
    }
  } else if (args.pr && args.fix) {
    console.error("No verified fixes to create a PR for.");
  }

  if (args.prComment) {
    try {
      const sha = await getHeadSha();
      await postPrReview(report.vectors, sha);
    } catch (err) {
      console.error(`WARNING: Failed to post PR comment: ${err instanceof Error ? err.message : err}`);
    }
  }

  if (args.interactive && allFindings.length > 0 && process.stdin.isTTY) {
    const result = await runInteractive(report, tests, provider);
    const acceptedCount = result.accepted.length + result.fixed.length;
    return acceptedCount > 0 && shouldFail([...result.accepted, ...result.fixed.map((f) => f.finding)], args.failOn) ? 1 : 0;
  }

  return shouldFail(allFindings, args.failOn) ? 1 : 0;
}

async function runConsensus(
  args: Args,
  files: Awaited<ReturnType<typeof getDiff>>,
  vectors: ReturnType<typeof getVectors>,
  primaryReports: VectorReport[]
): Promise<void> {
  const providerNames = args.consensusProviders ?? ["anthropic", "ollama"].filter((p) => p !== args.provider);
  if (providerNames.length === 0) return;

  const consensusSpinner = new Spinner(`Running consensus across ${providerNames.length + 1} models...`);
  consensusSpinner.start();

  const reportsByModel = new Map<string, VectorReport[]>();
  reportsByModel.set(args.provider, primaryReports);

  const sanitizedFiles = sanitizeDiff(files);
  const context = await loadContext(files);

  for (const provName of providerNames) {
    try {
      const altProvider = getProvider(provName, { maxTokens: args.maxTokens });

      const altSettled = await Promise.allSettled(
        vectors.map(async (vector) => {
          const findings = await vector.analyze(sanitizedFiles, context, altProvider);
          return { name: vector.name, findings, duration: 0 };
        })
      );

      const altReports: VectorReport[] = altSettled.map((r, idx) =>
        r.status === "fulfilled" ? r.value : { name: vectors[idx]!.name, findings: [], duration: 0 }
      );
      reportsByModel.set(provName, altReports);
    } catch (err) {
      console.error(`WARNING: Consensus provider "${provName}" failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const vectorNames = vectors.map((v) => v.name);
  const consensusReport = buildConsensus(reportsByModel, vectorNames);
  consensusSpinner.succeed(`Consensus: ${reportsByModel.size} model${reportsByModel.size === 1 ? "" : "s"} compared.`);
  process.stderr.write(formatConsensus(consensusReport) + "\n");
}
