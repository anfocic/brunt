#!/usr/bin/env node

import { run } from "./runner.ts";
import { listVectors } from "./vectors/registry.ts";
import { loadConfig, type BruntConfig } from "./config.ts";
import { init } from "./init.ts";
import { runDemo } from "./demo.ts";

export type Args = {
  command: string;
  diff: string;
  provider: string;
  format: "text" | "json" | "sarif";
  failOn: "low" | "medium" | "high" | "critical";
  vectors?: string[];
  noTests: boolean;
  noCache: boolean;
  prComment: boolean;
  maxTokens?: number;
  model?: string;
  concurrency?: number;
  sensitivePatterns?: string[];
  sensitiveEnabled?: boolean;
  fix: boolean;
  fixRetries: number;
  interactive: boolean;
  pr: boolean;
  consensus: boolean;
  consensusProviders?: string[];
};

type PartialArgs = {
  command: string;
  diff?: string;
  provider?: string;
  format?: "text" | "json" | "sarif";
  failOn?: "low" | "medium" | "high" | "critical";
  vectors?: string[];
  noTests?: boolean;
  noCache?: boolean;
  prComment?: boolean;
  maxTokens?: number;
  model?: string;
  fix?: boolean;
  fixRetries?: number;
  interactive?: boolean;
  pr?: boolean;
  consensus?: boolean;
  consensusProviders?: string[];
};

function detectDefaultDiff(): string {
  const baseRef = process.env.GITHUB_BASE_REF;
  if (baseRef) return `origin/${baseRef}..HEAD`;
  return "HEAD~1";
}

const VALID_PROVIDERS = ["claude-cli", "anthropic", "ollama"];
const VALID_FORMATS = ["text", "json", "sarif"];
const VALID_SEVERITIES = ["low", "medium", "high", "critical"];

function parseArgs(argv: string[]): PartialArgs {
  const args = argv.slice(2);
  const command = args[0] ?? "help";

  let diff: string | undefined;
  let provider: string | undefined;
  let format: PartialArgs["format"];
  let failOn: PartialArgs["failOn"];
  let vectors: string[] | undefined;
  let noTests: boolean | undefined;
  let noCache: boolean | undefined;
  let prComment: boolean | undefined;
  let maxTokens: number | undefined;
  let model: string | undefined;
  let fix: boolean | undefined;
  let fixRetries: number | undefined;
  let interactive: boolean | undefined;
  let pr: boolean | undefined;
  let consensus: boolean | undefined;
  let consensusProviders: string[] | undefined;

  for (let i = 1; i < args.length; i++) {
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
      format = next as PartialArgs["format"];
      i++;
    } else if (arg === "--fail-on" && next) {
      if (!VALID_SEVERITIES.includes(next)) {
        throw new Error(`Unknown severity: ${next}. Use ${VALID_SEVERITIES.map((s) => `"${s}"`).join(", ")}.`);
      }
      failOn = next as PartialArgs["failOn"];
      i++;
    } else if (arg === "--vectors" && next) {
      vectors = next.split(",").map((v) => v.trim());
      i++;
    } else if (arg === "--no-tests") {
      noTests = true;
    } else if (arg === "--no-cache") {
      noCache = true;
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
    } else if (arg === "--interactive") {
      interactive = true;
    } else if (arg === "--pr") {
      pr = true;
    } else if (arg === "--consensus") {
      consensus = true;
    } else if (arg === "--consensus-providers" && next) {
      consensusProviders = next.split(",").map((p) => p.trim());
      for (const p of consensusProviders) {
        if (!VALID_PROVIDERS.includes(p)) {
          throw new Error(`Unknown provider in --consensus-providers: ${p}. Use ${VALID_PROVIDERS.map((x) => `"${x}"`).join(", ")}.`);
        }
      }
      i++;
    } else if (arg === "--fix") {
      fix = true;
    } else if (arg === "--fix-retries" && next) {
      const n = parseInt(next, 10);
      if (isNaN(n) || n < 1 || n > 5) {
        throw new Error(`Invalid --fix-retries value: ${next}. Must be 1-5.`);
      }
      fixRetries = n;
      i++;
    } else if (arg?.startsWith("--")) {
      throw new Error(`Unknown flag: ${arg}. Run "brunt help" for usage.`);
    }
  }

  return { command, diff, provider, format, failOn, vectors, noTests, noCache, prComment, maxTokens, model, fix, fixRetries, interactive, pr, consensus, consensusProviders };
}

function mergeArgs(partial: PartialArgs, config: BruntConfig): Args {
  return {
    command: partial.command,
    diff: partial.diff ?? config.diff ?? detectDefaultDiff(),
    provider: partial.provider ?? config.provider ?? "claude-cli",
    format: (partial.format ?? config.format ?? "text") as Args["format"],
    failOn: (partial.failOn ?? config.failOn ?? "medium") as Args["failOn"],
    vectors: partial.vectors ?? config.vectors,
    noTests: partial.noTests ?? config.noTests ?? false,
    noCache: partial.noCache ?? false,
    prComment: partial.prComment ?? false,
    maxTokens: partial.maxTokens ?? config.maxTokens,
    model: partial.model ?? config.model,
    concurrency: config.concurrency,
    sensitivePatterns: config.sensitive?.patterns,
    sensitiveEnabled: config.sensitive?.enabled,
    fix: partial.fix ?? config.fix ?? false,
    fixRetries: partial.fixRetries ?? config.fixRetries ?? 2,
    interactive: partial.interactive ?? false,
    pr: partial.pr ?? false,
    consensus: partial.consensus ?? false,
    consensusProviders: partial.consensusProviders,
  };
}

function printHelp() {
  console.log(`
brunt - adversarial AI code review

USAGE
  brunt scan [options]
  brunt demo [--provider <name>]
  brunt init
  brunt list

COMMANDS
  scan    Analyze a diff for bugs and vulnerabilities
  demo    Run a showcase scan against a built-in buggy file
  init    Install git pre-push hook for automatic scanning
  list    Show available vectors

OPTIONS
  --diff <range>        Git diff range (default: HEAD~1)
  --provider <name>     LLM provider: claude-cli, anthropic, ollama (default: claude-cli)
  --model <name>        Model name (e.g. llama3 for ollama, claude-sonnet-4-6-20250514 for anthropic)
  --format <type>       Output format: text, json, sarif (default: text)
  --fail-on <severity>  Exit 1 at this severity: low, medium, high, critical (default: medium)
  --vectors <list>      Comma-separated vectors to run (default: all)
  --no-tests            Skip proof test generation
  --no-cache            Skip cache, force fresh LLM analysis
  --pr-comment          Post findings as GitHub PR review comments
  --max-tokens <n>      Maximum tokens per LLM call
  --fix                 Auto-generate fixes and verify against proof tests
  --fix-retries <n>     Max fix attempts per finding (default: 2, max: 5)
  --interactive         Enter interactive triage mode after scan
  --pr                  Create a PR with verified fixes (requires --fix)
  --consensus           Run scan across multiple models for agreement
  --consensus-providers Comma-separated providers for consensus mode

CONFIG
  Place a brunt.config.yaml in your project root to set defaults.
  CLI flags override config values.
`);
}

function printList() {
  const vectors = listVectors();
  console.log("\nAvailable vectors:\n");
  for (const v of vectors) {
    console.log(`  ${v.name.padEnd(16)} ${v.description}`);
  }
  console.log(`\nUse --vectors to select: brunt scan --vectors ${vectors.map((v) => v.name).join(",")}\n`);
}

async function main() {
  try {
    const partial = parseArgs(process.argv);

    if (partial.command === "help" || partial.command === "--help" || partial.command === "-h") {
      printHelp();
      process.exit(0);
    }

    if (partial.command === "init") {
      await init();
      process.exit(0);
    }

    if (partial.command === "list") {
      printList();
      process.exit(0);
    }

    if (partial.command === "demo") {
      const provider = partial.provider ?? "claude-cli";
      const exitCode = await runDemo(provider, partial.model);
      process.exit(exitCode);
    }

    if (partial.command !== "scan") {
      console.error(`Unknown command: ${partial.command}. Run "brunt help" for usage.`);
      process.exit(2);
    }

    const config = await loadConfig();
    const args = mergeArgs(partial, config);

    const exitCode = await run(args);
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

export { parseArgs, mergeArgs };
