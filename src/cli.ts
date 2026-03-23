#!/usr/bin/env bun

import { run } from "./runner.ts";

type Args = {
  command: string;
  diff: string;
  provider: "claude-cli" | "anthropic";
  format: "text" | "json";
  failOn: "low" | "medium" | "high" | "critical";
  vectors?: string[];
};

function parseArgs(argv: string[]): Args {
  const args = argv.slice(2);
  const command = args[0] ?? "help";

  let diff = "HEAD~1";
  let provider: Args["provider"] = "claude-cli";
  let format: Args["format"] = "text";
  let failOn: Args["failOn"] = "medium";
  let vectors: string[] | undefined;

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    if (arg === "--diff" && next) {
      diff = next;
      i++;
    } else if (arg === "--provider" && next) {
      if (next !== "claude-cli" && next !== "anthropic") {
        throw new Error(`Unknown provider: ${next}. Use "claude-cli" or "anthropic".`);
      }
      provider = next;
      i++;
    } else if (arg === "--format" && next) {
      if (next !== "text" && next !== "json") {
        throw new Error(`Unknown format: ${next}. Use "text" or "json".`);
      }
      format = next;
      i++;
    } else if (arg === "--fail-on" && next) {
      if (!["low", "medium", "high", "critical"].includes(next)) {
        throw new Error(`Unknown severity: ${next}. Use "low", "medium", "high", or "critical".`);
      }
      failOn = next as Args["failOn"];
      i++;
    } else if (arg === "--vectors" && next) {
      vectors = next.split(",").map((v) => v.trim());
      i++;
    }
  }

  return { command, diff, provider, format, failOn, vectors };
}

function printHelp() {
  console.log(`
vigil - adversarial AI code review

USAGE
  vigil scan [options]

OPTIONS
  --diff <range>        Git diff range (default: HEAD~1)
  --provider <name>     LLM provider: claude-cli, anthropic (default: claude-cli)
  --format <type>       Output format: text, json (default: text)
  --fail-on <severity>  Exit 1 at this severity: low, medium, high, critical (default: medium)
  --vectors <list>      Comma-separated vectors to run (default: all)
`);
}

async function main() {
  try {
    const args = parseArgs(process.argv);

    if (args.command === "help" || args.command === "--help" || args.command === "-h") {
      printHelp();
      process.exit(0);
    }

    if (args.command !== "scan") {
      console.error(`Unknown command: ${args.command}. Run "vigil help" for usage.`);
      process.exit(2);
    }

    const exitCode = await run(args);
    process.exit(exitCode);
  } catch (err) {
    console.error(`vigil error: ${err instanceof Error ? err.message : err}`);
    process.exit(2);
  }
}

main();

export type { Args };
