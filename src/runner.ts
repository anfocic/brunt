import type { Args } from "./cli.ts";
import { getDiff } from "./diff.ts";
import { loadContext } from "./context.ts";
import { analyze } from "./vectors/correctness.ts";
import { generateTests, writeTests } from "./proof/test-gen.ts";
import { formatText, formatJson, shouldFail } from "./reporter.ts";
import { ClaudeCliProvider } from "./providers/claude-cli.ts";
import { AnthropicProvider } from "./providers/anthropic.ts";
import type { Provider } from "./providers/types.ts";

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
  const provider = getProvider(args.provider);

  console.log("Parsing diff...");
  const files = await getDiff(args.diff);

  if (files.length === 0) {
    console.log("No code changes found in diff.");
    return 0;
  }

  console.log(`Analyzing ${files.length} file${files.length === 1 ? "" : "s"}...`);
  const context = await loadContext(files);

  console.log(`Running correctness analysis via ${provider.name}...`);
  const findings = await analyze(files, context, provider);

  let tests: Awaited<ReturnType<typeof generateTests>> = [];

  if (findings.length > 0) {
    console.log(`Found ${findings.length} issue${findings.length === 1 ? "" : "s"}. Generating proof tests...`);
    tests = await generateTests(findings, provider);
    await writeTests(tests);
  }

  const output =
    args.format === "json"
      ? formatJson(findings, tests)
      : formatText(findings, tests);

  console.log(output);

  return shouldFail(findings, args.failOn) ? 1 : 0;
}
