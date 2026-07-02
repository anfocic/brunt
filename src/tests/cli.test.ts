import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "child_process";
import { join } from "path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { parseArgs } from "../cli.js";
import type { BruntConfig } from "../config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "..", "..", "dist", "cli.js");

function run(...args: string[]) {
  const result = spawnSync("node", [CLI, ...args], {
    cwd: join(__dirname, "..", ".."),
    timeout: 5000,
  });
  return {
    stdout: result.stdout?.toString().trim() ?? "",
    stderr: result.stderr?.toString().trim() ?? "",
    exitCode: result.status ?? 2,
  };
}

describe("cli", () => {
  test("shows help with no args", () => {
    const { stdout, exitCode } = run("help");
    assert.strictEqual(exitCode, 0);
    assert.ok(stdout.includes("brunt - adversarial AI code review"));
    assert.ok(stdout.includes("--diff"));
    assert.ok(stdout.includes("--provider"));
    assert.ok(stdout.includes("--vectors"));
  });

  test("shows help with --help flag", () => {
    const { stdout, exitCode } = run("--help");
    assert.strictEqual(exitCode, 0);
    assert.ok(stdout.includes("brunt - adversarial AI code review"));
  });

  test("help includes options", () => {
    const { stdout } = run("help");
    assert.ok(stdout.includes("--model"));
    assert.ok(stdout.includes("--max-tokens"));
    assert.ok(stdout.includes("sarif"));
    assert.ok(stdout.includes("ollama"));
  });

  test("rejects unknown commands", () => {
    const { stderr, exitCode } = run("foobar");
    assert.strictEqual(exitCode, 2);
    assert.ok(stderr.includes("Unknown command: foobar"));
  });

  test("rejects unknown provider", () => {
    const { stderr, exitCode } = run("scan", "--provider", "gpt5");
    assert.strictEqual(exitCode, 2);
    assert.ok(stderr.includes("Unknown provider: gpt5"));
  });

  test("rejects unknown format", () => {
    const { stderr, exitCode } = run("scan", "--format", "xml");
    assert.strictEqual(exitCode, 2);
    assert.ok(stderr.includes("Unknown format: xml"));
  });

  test("rejects unknown severity", () => {
    const { stderr, exitCode } = run("scan", "--fail-on", "extreme");
    assert.strictEqual(exitCode, 2);
    assert.ok(stderr.includes("Unknown severity: extreme"));
  });

  test("rejects invalid max-tokens", () => {
    const { stderr, exitCode } = run("scan", "--max-tokens", "abc");
    assert.strictEqual(exitCode, 2);
    assert.ok(stderr.includes("Invalid --max-tokens"));
  });

  test("rejects negative max-tokens", () => {
    const { stderr, exitCode } = run("scan", "--max-tokens", "-100");
    assert.strictEqual(exitCode, 2);
    assert.ok(stderr.includes("Invalid --max-tokens"));
  });

  test("accepts ollama as a valid provider in arg parsing", () => {
    const { stderr } = run("scan", "--provider", "ollama");
    assert.ok(!stderr.includes("Use "));
  });

  test("rejects unknown flags", () => {
    const { stderr, exitCode } = run("scan", "--verbose");
    assert.strictEqual(exitCode, 2);
    assert.ok(stderr.includes("Unknown flag: --verbose"));
  });

  test("accepts sarif as a valid format in arg parsing", () => {
    const { stderr } = run("scan", "--format", "sarif", "--provider", "nonexistent");
    assert.ok(!stderr.includes("Unknown format"));
    assert.ok(stderr.includes("Unknown provider: nonexistent"));
  });

  test("accepts baseline as a valid command", () => {
    const { stderr } = run("baseline", "--provider", "nonexistent");
    assert.ok(!stderr.includes("Unknown command"));
  });

  test("accepts --no-baseline flag", () => {
    const { stderr } = run("scan", "--no-baseline", "--provider", "nonexistent");
    assert.ok(!stderr.includes("Unknown flag"));
  });

  test("accepts --baseline-path flag", () => {
    const { stderr } = run("scan", "--baseline-path", "custom.json", "--provider", "nonexistent");
    assert.ok(!stderr.includes("Unknown flag"));
  });

  test("help includes baseline command", () => {
    const { stdout } = run("help");
    assert.ok(stdout.includes("baseline"));
    assert.ok(stdout.includes("--no-baseline"));
  });
});

function scan(flags: string[], config?: BruntConfig) {
  return parseArgs(["node", "cli.js", "scan", ...flags], config);
}

describe("parseArgs config precedence", () => {
  test("built-in defaults apply when neither CLI nor config set a value", () => {
    const args = scan([]);
    assert.strictEqual(args.provider, "claude-cli");
    assert.strictEqual(args.format, "text");
    assert.strictEqual(args.failOn, "medium");
    assert.strictEqual(args.fixRetries, 2);
    assert.strictEqual(args.fix, false);
  });

  test("config supplies values when the CLI flag is absent", () => {
    const config: BruntConfig = {
      settings: { provider: "ollama", model: "llama3", failOn: "high", fix: true, fixRetries: 4 },
    };
    const args = scan([], config);
    assert.strictEqual(args.provider, "ollama");
    assert.strictEqual(args.model, "llama3");
    assert.strictEqual(args.failOn, "high");
    assert.strictEqual(args.fix, true);
    assert.strictEqual(args.fixRetries, 4);
  });

  test("an explicit CLI flag overrides the config value", () => {
    const config: BruntConfig = { settings: { provider: "ollama", failOn: "high" } };
    const args = scan(["--provider", "openai", "--fail-on", "low"], config);
    assert.strictEqual(args.provider, "openai");
    assert.strictEqual(args.failOn, "low");
  });

  test("config select drives vectors; --vectors overrides it", () => {
    const config: BruntConfig = { select: ["correctness", "security"] };
    assert.deepStrictEqual(scan([], config).vectors, ["correctness", "security"]);
    assert.deepStrictEqual(scan(["--vectors", "security"], config).vectors, ["security"]);
  });

  test("boolean config settings only turn flags on", () => {
    const config: BruntConfig = { settings: { verify: true, noTests: true } };
    const args = scan([], config);
    assert.strictEqual(args.verify, true);
    assert.strictEqual(args.noTests, true);
  });
});
