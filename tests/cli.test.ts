import { describe, test, expect } from "bun:test";
import { spawnSync } from "child_process";
import { join } from "path";

const CLI = join(import.meta.dir, "../src/cli.ts");

function run(...args: string[]) {
  const result = spawnSync("bun", ["run", CLI, ...args], {
    cwd: join(import.meta.dir, ".."),
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
    expect(exitCode).toBe(0);
    expect(stdout).toContain("brunt - adversarial AI code review");
    expect(stdout).toContain("--diff");
    expect(stdout).toContain("--provider");
    expect(stdout).toContain("--vectors");
  });

  test("shows help with --help flag", () => {
    const { stdout, exitCode } = run("--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("brunt - adversarial AI code review");
  });

  test("rejects unknown commands", () => {
    const { stderr, exitCode } = run("foobar");
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Unknown command: foobar");
  });

  test("rejects unknown provider", () => {
    const { stderr, exitCode } = run("scan", "--provider", "gpt5");
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Unknown provider: gpt5");
  });

  test("rejects unknown format", () => {
    const { stderr, exitCode } = run("scan", "--format", "xml");
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Unknown format: xml");
  });

  test("rejects unknown severity", () => {
    const { stderr, exitCode } = run("scan", "--fail-on", "extreme");
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Unknown severity: extreme");
  });
});
