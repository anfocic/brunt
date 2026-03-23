import type { Args } from "./cli.ts";
import { getDiff } from "./diff.ts";
import { loadContext } from "./context.ts";
import { sanitizeDiff } from "./sanitize.ts";
import { injectCanary, verifyCanary } from "./canary.ts";
import { getVectors } from "./vectors/registry.ts";
import type { VectorReport, ScanReport } from "./vectors/types.ts";
import { generateTests, writeTests } from "./proof/test-gen.ts";
import { formatText, formatJson, shouldFail } from "./reporter.ts";
import { ClaudeCliProvider } from "./providers/claude-cli.ts";
import { AnthropicProvider } from "./providers/anthropic.ts";
import type { Provider } from "./providers/types.ts";
import { checkGitRepo, checkProvider } from "./preflight.ts";

function getProvider(name: string): Provider {
  switch (name) {
    case "claude-cli":
      return new ClaudeCliProvider();
    case "anthropic":
      return new AnthropicProvider();
    default:
      throw new Error(`Unknown provider: ${name}`);
  }
}

export async function run(args: Args): Promise<number> {
  await checkGitRepo();
  await checkProvider(args.provider);

  const provider = getProvider(args.provider);
  const vectors = getVectors(args.vectors);
  const scanStart = performance.now();

  console.error("Parsing diff...");
  const files = await getDiff(args.diff);

  if (files.length === 0) {
    console.error("No code changes found in diff.");
    return 0;
  }

  console.error(`Analyzing ${files.length} file${files.length === 1 ? "" : "s"}...`);

  const sanitizedFiles = sanitizeDiff(files);
  const { files: filesWithCanary, canary } = injectCanary(sanitizedFiles);

  const context = await loadContext(files); // context uses original files (need real paths)

  console.error(`Running ${vectors.length} vector${vectors.length === 1 ? "" : "s"} via ${provider.name}...`);

  const vectorReports: VectorReport[] = await Promise.all(
    vectors.map(async (vector) => {
      const start = performance.now();
      const findings = await vector.analyze(filesWithCanary, context, provider);
      return {
        name: vector.name,
        findings,
        duration: Math.round(performance.now() - start),
      };
    })
  );

  // Verify canary was detected — if not, analysis may have been compromised
  const allRawFindings = vectorReports.flatMap((v) => v.findings);
  const canaryFound = verifyCanary(allRawFindings, canary);

  if (!canaryFound) {
    console.error("WARNING: Canary bug was not detected. Analysis may have been compromised by prompt injection.");
    console.error("         Results may be unreliable. Review the diff manually.");
  }

  // Strip canary findings from results — users shouldn't see them
  for (const vr of vectorReports) {
    vr.findings = vr.findings.filter(
      (f) => f.file !== canary.file && !f.title.includes(canary.keyword) && !f.description.includes(canary.keyword)
    );
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
    tests = await generateTests(allFindings, provider);
    await writeTests(tests);
  } else if (allFindings.length > 0) {
    console.error(`Found ${report.totalFindings} issue${report.totalFindings === 1 ? "" : "s"}.`);
  }

  const output =
    args.format === "json"
      ? formatJson(report, tests)
      : formatText(report, tests);

  process.stdout.write(output + "\n");

  return shouldFail(allFindings, args.failOn) ? 1 : 0;
}
