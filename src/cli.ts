#!/usr/bin/env node

import { run, runBaseline } from "./runner.js";

export type Args = {
  command: "scan" | "baseline";
  diff: string;
  provider: string;
  format: "text" | "json" | "sarif";
  failOn: "low" | "medium" | "high" | "critical";
  vectors?: string[];
  scope?: string;
  noTests: boolean;
  noCache: boolean;
  noBaseline: boolean;
  prComment: boolean;
  maxTokens?: number;
  model?: string;
  baselinePath?: string;
  concurrency: number;
  fix: boolean;
  fixRetries: number;
  pr: boolean;
  verify: boolean;
};

const VALID_PROVIDERS = ["claude-cli", "anthropic", "ollama", "openai"];
const VALID_FORMATS = ["text", "json", "sarif"];
const VALID_SEVERITIES = ["low", "medium", "high", "critical"];

function detectDefaultDiff(): string {
  const baseRef = process.env.GITHUB_BASE_REF;
  if (baseRef) return `origin/${baseRef}..HEAD`;
  return "HEAD~1";
}

export function parseArgs(argv: string[]): Args {
  const args = argv.slice(2);
  const command = args[0] ?? "help";

  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    process.exit(0);
  }

  if (command !== "scan" && command !== "baseline" && !command.startsWith("--")) {
    throw new Error(`Unknown command: ${command}. Run "brunt help" for usage.`);
  }

  const startIdx = command === "scan" || command === "baseline" ? 1 : 0;

  let diff: string | undefined;
  let provider: string | undefined;
  let format: Args["format"] | undefined;
  let failOn: Args["failOn"] | undefined;
  let vectors: string[] | undefined;
  let noTests = false;
  let noCache = false;
  let noBaseline = false;
  let prComment = false;
  let baselinePath: string | undefined;
  let maxTokens: number | undefined;
  let model: string | undefined;
  let scope: string | undefined;
  let fix = false;
  let fixRetries: number | undefined;
  let pr = false;
  let verify = false;

  for (let i = startIdx; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    if (arg === "--diff" && next) {
      diff = next;
      i++;
    } else if (arg === "--provider" && next) {
      if (!VALID_PROVIDERS.includes(next)) {
        throw new Error(`Unknown provider: ${next}. Use ${VALID_PROVIDERS.map((p) => `"${p}"`).join(", ")}.`);
      }
      provider = next;
      i++;
    } else if (arg === "--format" && next) {
      if (!VALID_FORMATS.includes(next)) {
        throw new Error(`Unknown format: ${next}. Use ${VALID_FORMATS.map((f) => `"${f}"`).join(", ")}.`);
      }
      format = next as Args["format"];
      i++;
    } else if (arg === "--fail-on" && next) {
      if (!VALID_SEVERITIES.includes(next)) {
        throw new Error(`Unknown severity: ${next}. Use ${VALID_SEVERITIES.map((s) => `"${s}"`).join(", ")}.`);
      }
      failOn = next as Args["failOn"];
      i++;
    } else if (arg === "--vectors" && next) {
      vectors = next.split(",").map((v) => v.trim());
      i++;
    } else if (arg === "--no-tests") {
      noTests = true;
    } else if (arg === "--no-cache") {
      noCache = true;
    } else if (arg === "--no-baseline") {
      noBaseline = true;
    } else if (arg === "--baseline-path" && next) {
      baselinePath = next;
      i++;
    } else if (arg === "--pr-comment") {
      prComment = true;
    } else if (arg === "--max-tokens" && next) {
      const n = parseInt(next, 10);
      if (isNaN(n) || n <= 0) {
        throw new Error(`Invalid --max-tokens value: ${next}. Must be a positive integer.`);
      }
      maxTokens = n;
      i++;
    } else if (arg === "--model" && next) {
      model = next;
      i++;
    } else if (arg === "--pr") {
      pr = true;
    } else if (arg === "--fix") {
      fix = true;
    } else if (arg === "--fix-retries" && next) {
      const n = parseInt(next, 10);
      if (isNaN(n) || n < 1 || n > 5) {
        throw new Error(`Invalid --fix-retries value: ${next}. Must be 1-5.`);
      }
      fixRetries = n;
      i++;
    } else if (arg === "--scope" && next) {
      scope = next;
      i++;
    } else if (arg === "--verify") {
      verify = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else if (arg?.startsWith("--")) {
      throw new Error(`Unknown flag: ${arg}. Run "brunt help" for usage.`);
    }
  }

  return {
    command: (command === "baseline" ? "baseline" : "scan") as Args["command"],
    diff: diff ?? detectDefaultDiff(),
    provider: provider ?? "claude-cli",
    format: format ?? "text",
    failOn: failOn ?? "medium",
    vectors,
    scope,
    noTests,
    noCache,
    noBaseline,
    prComment,
    maxTokens,
    model,
    baselinePath,
    concurrency: 3,
    fix,
    fixRetries: fixRetries ?? 2,
    pr,
    verify,
  };
}

function printHelp() {
  console.log(`
brunt - adversarial AI code review

USAGE
  brunt scan [options]
  brunt baseline [options]
  brunt help

COMMANDS
  scan       Analyze a diff for bugs and vulnerabilities (default)
  baseline   Run scan and save findings as suppression baseline
  help       Show this help

OPTIONS
  --diff <range>        Git diff range (default: HEAD~1)
  --provider <name>     LLM provider: claude-cli, anthropic, ollama, openai (default: claude-cli)
  --model <name>        Model name (e.g. llama3 for ollama, gpt-4o for openai)
  --format <type>       Output format: text, json, sarif (default: text)
  --fail-on <severity>  Exit 1 at this severity: low, medium, high, critical (default: medium)
  --vectors <list>      Comma-separated vectors to run (default: all)
  --scope <path>        Only scan files under this path (auto-detects in monorepos)
  --no-tests            Skip proof test generation
  --no-cache            Skip cache, force fresh LLM analysis
  --no-baseline         Ignore baseline, show all findings
  --baseline-path <f>   Path to baseline file (default: .brunt-baseline.json)
  --pr-comment          Post findings as GitHub PR review comments
  --max-tokens <n>      Maximum tokens per LLM call
  --verify              Run proof tests and drop findings that can't be reproduced
  --fix                 Auto-generate fixes and verify against proof tests
  --fix-retries <n>     Max fix attempts per finding (default: 2, max: 5)
  --pr                  Create a PR with verified fixes (requires --fix)
`);
}

async function main() {
  try {
    const args = parseArgs(process.argv);
    const exitCode = args.command === "baseline"
      ? await runBaseline(args)
      : await run(args);
    process.exit(exitCode);
  } catch (err) {
    console.error(`brunt error: ${err instanceof Error ? err.message : err}`);
    process.exit(2);
  }
}

const scriptName = process.argv[1]?.split("/").pop() ?? "";
const isDirectRun = /^cli\.(ts|js|mjs)$/.test(scriptName) || scriptName === "brunt";

if (isDirectRun) {
  main();
}
