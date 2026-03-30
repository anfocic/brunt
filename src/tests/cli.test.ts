import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "child_process";
import { join } from "path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

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
});
