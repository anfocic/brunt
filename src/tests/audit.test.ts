import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { getFullRepo } from "../diff.js";
import { spawnSync } from "child_process";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

function createTempGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "brunt-audit-"));
  spawnSync("git", ["init"], { cwd: dir });
  spawnSync("git", ["config", "user.email", "test@test.com"], { cwd: dir });
  spawnSync("git", ["config", "user.name", "test"], { cwd: dir });
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

describe("getFullRepo", () => {
  test("returns tracked files as DiffFile[]", withRepo(async (dir) => {
    writeFileSync(join(dir, "app.ts"), "export const x = 1;\n");
    writeFileSync(join(dir, "util.ts"), "export const y = 2;\n");
    spawnSync("git", ["add", "."], { cwd: dir });
    spawnSync("git", ["commit", "-m", "init"], { cwd: dir });

    const files = await getFullRepo();
    assert.ok(files.length >= 2);
    const paths = files.map((f) => f.path);
    assert.ok(paths.includes("app.ts"));
    assert.ok(paths.includes("util.ts"));

    const app = files.find((f) => f.path === "app.ts")!;
    assert.strictEqual(app.language, "typescript");
    assert.strictEqual(app.hunks.length, 1);
    assert.ok(app.hunks[0].added.length > 0);
    assert.strictEqual(app.hunks[0].removed.length, 0);
  }));

  test("filters by scope", withRepo(async (dir) => {
    spawnSync("mkdir", ["-p", "packages/auth", "packages/billing"], { cwd: dir });
    writeFileSync(join(dir, "packages/auth/login.ts"), "export function login() {}\n");
    writeFileSync(join(dir, "packages/billing/charge.ts"), "export function charge() {}\n");
    spawnSync("git", ["add", "."], { cwd: dir });
    spawnSync("git", ["commit", "-m", "init"], { cwd: dir });

    const files = await getFullRepo("packages/auth");
    const paths = files.map((f) => f.path);
    assert.ok(paths.includes("packages/auth/login.ts"));
    assert.ok(!paths.includes("packages/billing/charge.ts"));
  }));

  test("excludes sensitive and ignored files", withRepo(async (dir) => {
    writeFileSync(join(dir, "app.ts"), "export const x = 1;\n");
    writeFileSync(join(dir, ".env"), "SECRET=abc\n");
    writeFileSync(join(dir, "icon.png"), "fake-png");
    spawnSync("git", ["add", "."], { cwd: dir });
    spawnSync("git", ["commit", "-m", "init"], { cwd: dir });

    const files = await getFullRepo();
    const paths = files.map((f) => f.path);
    assert.ok(paths.includes("app.ts"));
    assert.ok(!paths.includes(".env"));
    assert.ok(!paths.includes("icon.png"));
  }));
});
