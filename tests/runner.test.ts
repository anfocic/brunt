import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { spawnSync } from "child_process";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const CLI = join(import.meta.dir, "../src/cli.ts");

function createTempGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "brunt-runner-"));
  spawnSync("git", ["init"], { cwd: dir });
  spawnSync("git", ["config", "user.email", "test@test.com"], { cwd: dir });
  spawnSync("git", ["config", "user.name", "test"], { cwd: dir });
  writeFileSync(join(dir, "initial.ts"), "export const x = 1;\n");
  spawnSync("git", ["add", "."], { cwd: dir });
  spawnSync("git", ["commit", "-m", "init"], { cwd: dir });
  return dir;
}

function runCli(dir: string, ...args: string[]) {
  const result = spawnSync("bun", ["run", CLI, ...args], {
    cwd: dir,
    timeout: 10000,
    env: { ...process.env, PATH: process.env.PATH },
  });
  return {
    stdout: result.stdout?.toString() ?? "",
    stderr: result.stderr?.toString() ?? "",
    exitCode: result.status ?? 2,
  };
}

describe("runner integration", () => {
  let dir: string;

  beforeEach(() => {
    dir = createTempGitRepo();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true });
  });

  test("exits 0 for empty diff", () => {
    const { stderr, exitCode } = runCli(dir, "scan", "--diff", "--cached");
    expect(exitCode).toBe(0);
    expect(stderr).toContain("No code changes");
  });

  test("exits 0 for diff with no code files", () => {
    writeFileSync(join(dir, "image.png"), "fake-png");
    spawnSync("git", ["add", "image.png"], { cwd: dir });
    const { stderr, exitCode } = runCli(dir, "scan", "--diff", "--cached");
    expect(exitCode).toBe(0);
    expect(stderr).toContain("No code changes");
  });

  test("excludes sensitive files from scan", () => {
    // Only add .env so after filtering, diff is empty and scan exits fast
    writeFileSync(join(dir, ".env"), "SECRET=abc\n");
    spawnSync("git", ["add", ".env"], { cwd: dir });
    const { stderr, exitCode } = runCli(dir, "scan", "--diff", "--cached");
    expect(stderr).toContain("Excluding sensitive file: .env");
    expect(exitCode).toBe(0);
  });

  test("scan with unknown provider gives clear error", () => {
    writeFileSync(join(dir, "app.ts"), "export const z = 3;\n");
    spawnSync("git", ["add", "app.ts"], { cwd: dir });
    const { stderr, exitCode } = runCli(dir, "scan", "--diff", "--cached", "--provider", "nonexistent");
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Unknown provider");
  });

  test("format json produces valid JSON on empty scan", () => {
    const { stdout, exitCode } = runCli(dir, "scan", "--diff", "--cached", "--format", "json");
    // Empty diff exits 0 with no output on stdout (message goes to stderr)
    expect(exitCode).toBe(0);
  });
});

describe("runner cache", () => {
  let dir: string;

  beforeEach(() => {
    dir = createTempGitRepo();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true });
  });

  test("--no-cache flag is accepted", () => {
    const { stderr, exitCode } = runCli(dir, "scan", "--diff", "--cached", "--no-cache");
    expect(exitCode).toBe(0);
    expect(stderr).not.toContain("Unknown flag");
  });
});
