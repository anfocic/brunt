import type { Args } from "./cli.js";
import { getDiff } from "./diff.js";
import { correctness } from "./vectors/correctness.js";
import { security } from "./vectors/security.js";
import type { Vector, VectorReport, ScanReport } from "./vectors/types.js";
import { generateTests, writeTests, verifyTests, verifyTestsAgainstBase, restoreFromManifest } from "./proof/test-gen.js";
import { resolveBaseRef } from "./diff.js";
import { formatText, formatJson, formatSarif, shouldFail } from "./reporter.js";
import { createProvider, type Provider, type ProviderName } from "@packages/llm";
import { checkGitRepo, checkProvider } from "./preflight.js";
import { postPrReview, getHeadSha } from "./github.js";
import { fixAll, type FixVerification } from "./fix/fix-gen.js";
import { createFixPr } from "./fix/pr.js";
import { Spinner, ProgressBoard, printBanner } from "./tui.js";
import { findingKey } from "./util.js";
import { scanEngine, type ProgressEvent } from "./engine.js";
import { loadBaseline, saveBaseline, filterBaselined, computeFingerprint, BASELINE_PATH, type BaselineEntry } from "./baseline.js";
import { filterByScope, detectScope } from "./scope.js";

const ALL_VECTORS: Vector[] = [correctness, security];

function getVectors(names?: string[]): Vector[] {
  if (!names || names.length === 0) return ALL_VECTORS;
  return names.map((name) => {
    const v = ALL_VECTORS.find((v) => v.name === name);
    if (!v) throw new Error(`Unknown vector: "${name}". Available: ${ALL_VECTORS.map((v) => v.name).join(", ")}`);
    return v;
  });
}

function getProvider(name: string, options: { maxTokens?: number; model?: string; timeout?: number } = {}): Provider {
  return createProvider(name as ProviderName, options);
}

export async function run(args: Args): Promise<number> {
  printBanner();

  // Recover files if a previous base-branch check was interrupted
  const restored = await restoreFromManifest();
  if (restored) {
    console.error("WARNING: Restored files from a previous interrupted base-branch check.");
  }

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

  const allFiles = await getDiff(args.diff);

  // Monorepo scoping
  let files = allFiles;
  let scopeUsed: string | null = null;

  if (args.scope === ".") {
    // Explicit "scan everything"
  } else if (args.scope) {
    files = filterByScope(allFiles, args.scope);
    scopeUsed = args.scope;
  } else {
    const detected = detectScope(allFiles);
    if (detected) {
      files = filterByScope(allFiles, detected);
      scopeUsed = detected;
    }
  }

  if (scopeUsed) {
    spinner.succeed(`Scoped to ${scopeUsed} (${files.length}/${allFiles.length} file${allFiles.length === 1 ? "" : "s"}).`);
  }

  if (files.length === 0) {
    spinner.succeed("No code changes found in diff.");
    return 0;
  }

  spinner.succeed(`Parsed ${files.length} file${files.length === 1 ? "" : "s"}.`);

  const board = new ProgressBoard(vectors.map((v) => v.name));
  let boardStarted = false;

  const { vectorReports, fromCache } = await scanEngine(
    {
      files,
      vectors,
      provider,
      noCache: args.noCache,
      providerName: args.provider,
      model: args.model,
    },
    (event: ProgressEvent) => {
      switch (event.type) {
        case "injection-detected":
          console.error(`WARNING: Possible prompt injection in ${event.file}`);
          console.error(`         "${event.line}"`);
          console.error("         Review this file manually — analysis may be compromised.");
          break;
        case "cache-hit":
          spinner.start("Cache hit — skipping LLM analysis.");
          spinner.succeed("Cache hit — loaded previous results.");
          break;
        case "vectors-start":
          process.stderr.write(`\n  Running ${event.total} vector${event.total === 1 ? "" : "s"} via ${provider.name}:\n\n`);
          for (const v of vectors) board.update(v.name, "running");
          boardStarted = true;
          break;
        case "vector-done":
          board.update(event.name, "done", `${event.count} finding${event.count === 1 ? "" : "s"}`, event.duration);
          break;
        case "vector-failed":
          board.update(event.name, "failed", event.message);
          console.error(`WARNING: Vector "${event.name}" failed: ${event.message}`);
          break;
        case "canary-missed":
          console.error("WARNING: Canary bug was not detected. Analysis may have been compromised by prompt injection.");
          console.error("         Results may be unreliable. Review the diff manually.");
          break;
        case "canary-failed":
          console.error("WARNING: Canary two-pass verification failed. The canary match may be a false positive.");
          console.error("         Results may be unreliable. Review the diff manually.");
          break;
        case "suspicious-silence":
          console.error(`WARNING: ${event.file} touches security-sensitive code but produced zero findings. Review manually.`);
          break;
      }
    }
  );

  if (boardStarted) board.finish();

  const report: ScanReport = {
    vectors: vectorReports,
    totalFindings: vectorReports.reduce((sum, v) => sum + v.findings.length, 0),
    totalDuration: Math.round(performance.now() - scanStart),
  };

  let suppressedCount = 0;
  if (!args.noBaseline) {
    const baseline = await loadBaseline(args.baselinePath);
    if (baseline) {
      const result = filterBaselined(vectorReports, baseline);
      for (let i = 0; i < vectorReports.length; i++) {
        vectorReports[i] = result.filtered[i];
      }
      report.totalFindings = vectorReports.reduce((sum, v) => sum + v.findings.length, 0);
      suppressedCount = result.suppressedCount;
    }
  }

  let allFindings = vectorReports.flatMap((v) => v.findings);
  let tests: Awaited<ReturnType<typeof generateTests>> = [];
  let fixes: FixVerification[] = [];

  if (allFindings.length > 0 && !args.noTests) {
    const testSpinner = new Spinner(`Generating proof tests for ${report.totalFindings} issue${report.totalFindings === 1 ? "" : "s"}...`);
    testSpinner.start();
    tests = await generateTests(allFindings, provider, args.concurrency);
    await writeTests(tests);
    testSpinner.succeed(`Generated ${tests.length} proof test${tests.length === 1 ? "" : "s"}.`);

    if (args.verify && tests.length > 0) {
      const verifySpinner = new Spinner(`Verifying ${tests.length} proof test${tests.length === 1 ? "" : "s"}...`);
      verifySpinner.start();
      const results = await verifyTests(tests, args.concurrency);
      const verified = results.filter((r) => r.verified);
      const dropped = results.filter((r) => !r.verified);

      if (dropped.length > 0) {
        const droppedFindings = new Set(dropped.map((r) => findingKey(r.test.finding)));
        tests = tests.filter((t) => !droppedFindings.has(findingKey(t.finding)));
        for (const vr of vectorReports) {
          vr.findings = vr.findings.filter((f) => !droppedFindings.has(findingKey(f)));
        }
        report.totalFindings = vectorReports.reduce((sum, v) => sum + v.findings.length, 0);
      }

      verifySpinner.succeed(`Verified: ${verified.length} confirmed, ${dropped.length} dropped (test passed = no bug).`);
      allFindings = vectorReports.flatMap((v) => v.findings);

      // Base-branch verification: drop findings where test also fails on base
      if (tests.length > 0) {
        const baseSpinner = new Spinner(`Base-branch check: ${tests.length} test${tests.length === 1 ? "" : "s"}...`);
        baseSpinner.start();
        try {
          const baseRef = await resolveBaseRef(args.diff);
          const baseResults = await verifyTestsAgainstBase(tests, baseRef, args.concurrency);
          const baseDrop = baseResults.filter((r) => !r.kept);

          if (baseDrop.length > 0) {
            const droppedFindings = new Set(baseDrop.map((r) => findingKey(r.test.finding)));
            tests = tests.filter((t) => !droppedFindings.has(findingKey(t.finding)));
            for (const vr of vectorReports) {
              vr.findings = vr.findings.filter((f) => !droppedFindings.has(findingKey(f)));
            }
            report.totalFindings = vectorReports.reduce((sum, v) => sum + v.findings.length, 0);
          }

          const kept = baseResults.filter((r) => r.kept).length;
          baseSpinner.succeed(`Base-branch: ${kept} confirmed, ${baseDrop.length} dropped (pre-existing or false positive).`);
          allFindings = vectorReports.flatMap((v) => v.findings);
        } catch (err) {
          baseSpinner.fail(`Base-branch check failed: ${err instanceof Error ? err.message : err}`);
        }
      }
    }
  } else if (allFindings.length > 0) {
    const s = new Spinner("");
    s.succeed(`Found ${report.totalFindings} issue${report.totalFindings === 1 ? "" : "s"}.`);
  }

  if (args.fix && args.noTests) {
    console.error("WARNING: --fix requires test generation. Use without --no-tests.");
  } else if (args.fix && tests.length > 0) {
    const fixSpinner = new Spinner(`Generating fixes and verifying (${tests.length} finding${tests.length === 1 ? "" : "s"})...`);
    fixSpinner.start();
    fixes = await fixAll(allFindings, tests, provider, args.concurrency, args.fixRetries);
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
      ? formatJson(report, tests, fixes, suppressedCount)
      : args.format === "sarif"
        ? formatSarif(report, tests, suppressedCount)
        : formatText(report, tests, fixes, suppressedCount);

  process.stdout.write(output + "\n");

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

  return shouldFail(allFindings, args.failOn) ? 1 : 0;
}

export async function runBaseline(args: Args): Promise<number> {
  printBanner();
  await checkGitRepo();
  await checkProvider(args.provider, args.model);

  const provider = getProvider(args.provider, {
    maxTokens: args.maxTokens,
    model: args.model,
  });
  const vectors = getVectors(args.vectors);

  const spinner = new Spinner("Parsing diff...");
  spinner.start();

  const allBaselineFiles = await getDiff(args.diff);

  // Monorepo scoping
  let files = allBaselineFiles;
  let scopeUsed: string | null = null;

  if (args.scope === ".") {
    // Explicit "scan everything"
  } else if (args.scope) {
    files = filterByScope(allBaselineFiles, args.scope);
    scopeUsed = args.scope;
  } else {
    const detected = detectScope(allBaselineFiles);
    if (detected) {
      files = filterByScope(allBaselineFiles, detected);
      scopeUsed = detected;
    }
  }

  if (scopeUsed) {
    spinner.succeed(`Scoped to ${scopeUsed} (${files.length}/${allBaselineFiles.length} file${allBaselineFiles.length === 1 ? "" : "s"}).`);
  }

  if (files.length === 0) {
    spinner.succeed("No code changes found in diff.");
    return 0;
  }

  spinner.succeed(`Parsed ${files.length} file${files.length === 1 ? "" : "s"}.`);

  const board = new ProgressBoard(vectors.map((v) => v.name));
  let boardStarted = false;

  const { vectorReports } = await scanEngine(
    {
      files,
      vectors,
      provider,
      noCache: args.noCache,
      providerName: args.provider,
      model: args.model,
    },
    (event: ProgressEvent) => {
      switch (event.type) {
        case "vectors-start":
          process.stderr.write(`\n  Running ${event.total} vector${event.total === 1 ? "" : "s"} via ${provider.name}:\n\n`);
          for (const v of vectors) board.update(v.name, "running");
          boardStarted = true;
          break;
        case "vector-done":
          board.update(event.name, "done", `${event.count} finding${event.count === 1 ? "" : "s"}`, event.duration);
          break;
        case "vector-failed":
          board.update(event.name, "failed", event.message);
          break;
      }
    }
  );

  if (boardStarted) board.finish();

  const entries: BaselineEntry[] = [];
  for (const vr of vectorReports) {
    for (const f of vr.findings) {
      entries.push({
        fingerprint: computeFingerprint(vr.name, f),
        vector: vr.name,
        file: f.file,
        line: f.line,
        title: f.title,
        severity: f.severity,
      });
    }
  }

  const baselinePath = args.baselinePath ?? BASELINE_PATH;
  await saveBaseline(entries, baselinePath);

  process.stderr.write(`\nBaselined ${entries.length} finding${entries.length === 1 ? "" : "s"} to ${baselinePath}\n`);
  process.stderr.write("Future scans will suppress these findings. Use --no-baseline to see all.\n\n");

  return 0;
}
