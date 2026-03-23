import { describe, test, expect } from "bun:test";
import { getDiff } from "../src/diff.ts";
import { spawnSync } from "child_process";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

function createTempGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "vigil-test-"));
  spawnSync("git", ["init"], { cwd: dir });
  spawnSync("git", ["config", "user.email", "test@test.com"], { cwd: dir });
  spawnSync("git", ["config", "user.name", "test"], { cwd: dir });

  writeFileSync(join(dir, "initial.ts"), "export const x = 1;\n");
  spawnSync("git", ["add", "."], { cwd: dir });
  spawnSync("git", ["commit", "-m", "init"], { cwd: dir });

  return dir;
}

function withRepo(fn: (dir: string) => Promise<void>) {
  return async () => {
    const dir = createTempGitRepo();
    const origDir = process.cwd();
    try {
      process.chdir(dir);
      await fn(dir);
    } finally {
      process.chdir(origDir);
      rmSync(dir, { recursive: true });
    }
  };
}

describe("getDiff", () => {
  test("parses added lines from a diff", withRepo(async (dir) => {
    writeFileSync(join(dir, "hello.ts"), 'export function hello() {\n  return "world";\n}\n');
    spawnSync("git", ["add", "hello.ts"], { cwd: dir });

    const files = await getDiff("--cached");
    expect(files.length).toBe(1);
    expect(files[0].path).toBe("hello.ts");
    expect(files[0].language).toBe("typescript");
    expect(files[0].hunks.length).toBeGreaterThan(0);
    expect(files[0].hunks[0].added.length).toBe(3);
  }));

  test("detects removed lines", withRepo(async (dir) => {
    writeFileSync(join(dir, "initial.ts"), "export const y = 2;\n");
    spawnSync("git", ["add", "initial.ts"], { cwd: dir });

    const files = await getDiff("--cached");
    expect(files.length).toBe(1);
    expect(files[0].hunks[0].removed.length).toBeGreaterThan(0);
    expect(files[0].hunks[0].added.length).toBeGreaterThan(0);
  }));

  test("filters out lockfiles and images", withRepo(async (dir) => {
    writeFileSync(join(dir, "package-lock.json"), "{}");
    writeFileSync(join(dir, "icon.png"), "fake-png");
    writeFileSync(join(dir, "real.ts"), "export const z = 3;\n");
    spawnSync("git", ["add", "."], { cwd: dir });

    const files = await getDiff("--cached");
    const paths = files.map((f) => f.path);
    expect(paths).toContain("real.ts");
    expect(paths).not.toContain("package-lock.json");
    expect(paths).not.toContain("icon.png");
  }));

  test("returns empty array for no changes", withRepo(async () => {
    const files = await getDiff("--cached");
    expect(files).toEqual([]);
  }));

  test("infers language from extension", withRepo(async (dir) => {
    writeFileSync(join(dir, "app.py"), "x = 1\n");
    writeFileSync(join(dir, "lib.rs"), "fn main() {}\n");
    writeFileSync(join(dir, "index.jsx"), "export default () => null;\n");
    spawnSync("git", ["add", "."], { cwd: dir });

    const files = await getDiff("--cached");
    const langMap = new Map(files.map((f) => [f.path, f.language]));
    expect(langMap.get("app.py")).toBe("python");
    expect(langMap.get("lib.rs")).toBe("rust");
    expect(langMap.get("index.jsx")).toBe("javascript");
  }));
});
