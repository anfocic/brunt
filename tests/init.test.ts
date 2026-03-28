import { describe, test, expect } from "bun:test";
import { spawnSync } from "child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, chmodSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

function createTempGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "brunt-init-"));
  spawnSync("git", ["init"], { cwd: dir });
  spawnSync("git", ["config", "user.email", "test@test.com"], { cwd: dir });
  spawnSync("git", ["config", "user.name", "test"], { cwd: dir });
  writeFileSync(join(dir, "init.ts"), "export const x = 1;\n");
  spawnSync("git", ["add", "."], { cwd: dir });
  spawnSync("git", ["commit", "-m", "init"], { cwd: dir });
  return dir;
}

const CLI = join(import.meta.dir, "../src/cli.ts");

describe("brunt init", () => {
  test("creates pre-push hook", () => {
    const dir = createTempGitRepo();
    try {
      const result = spawnSync("bun", ["run", CLI, "init"], {
        cwd: dir,
        timeout: 5000,
      });
      const stdout = result.stdout?.toString().trim() ?? "";
      expect(stdout).toContain("pre-push hook installed");

      const hookPath = join(dir, ".git", "hooks", "pre-push");
      expect(existsSync(hookPath)).toBe(true);

      const content = readFileSync(hookPath, "utf-8");
      expect(content).toContain("brunt");
      expect(content).toContain("#!/bin/sh");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  test("is idempotent", () => {
    const dir = createTempGitRepo();
    try {
      spawnSync("bun", ["run", CLI, "init"], { cwd: dir, timeout: 5000 });
      const result = spawnSync("bun", ["run", CLI, "init"], {
        cwd: dir,
        timeout: 5000,
      });
      const stdout = result.stdout?.toString().trim() ?? "";
      expect(stdout).toContain("already installed");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  test("appends to existing hook", () => {
    const dir = createTempGitRepo();
    try {
      const hooksDir = join(dir, ".git", "hooks");
      const hookPath = join(hooksDir, "pre-push");
      writeFileSync(hookPath, "#!/bin/sh\necho 'existing hook'\n");
      chmodSync(hookPath, 0o755);

      spawnSync("bun", ["run", CLI, "init"], { cwd: dir, timeout: 5000 });

      const content = readFileSync(hookPath, "utf-8");
      expect(content).toContain("existing hook");
      expect(content).toContain("brunt");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});
