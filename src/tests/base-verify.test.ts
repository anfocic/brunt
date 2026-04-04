import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { resolveBaseRef } from "../diff.js";
import { getBaseFileContent, restoreFromManifest } from "../proof/test-gen.js";
import { spawnSync } from "child_process";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

function createTempGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "brunt-base-verify-"));
  spawnSync("git", ["init"], { cwd: dir });
  spawnSync("git", ["config", "user.email", "test@test.com"], { cwd: dir });
  spawnSync("git", ["config", "user.name", "test"], { cwd: dir });

  writeFileSync(join(dir, "app.ts"), "export const x = 1;\n");
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

describe("resolveBaseRef", () => {
  test("--cached resolves to HEAD", withRepo(async () => {
    const ref = await resolveBaseRef("--cached");
    assert.match(ref, /^[0-9a-f]{40}$/);
  }));

  test("--staged resolves to HEAD", withRepo(async () => {
    const ref = await resolveBaseRef("--staged");
    assert.match(ref, /^[0-9a-f]{40}$/);
  }));

  test("range with .. extracts left side", withRepo(async () => {
    // Create a second commit so HEAD~1 exists
    writeFileSync("extra.ts", "export const y = 2;\n");
    spawnSync("git", ["add", "."]);
    spawnSync("git", ["commit", "-m", "second"]);

    const ref = await resolveBaseRef("HEAD~1..HEAD");
    const expected = spawnSync("git", ["rev-parse", "HEAD~1"]).stdout.toString().trim();
    assert.strictEqual(ref, expected);
  }));

  test("plain ref resolves directly", withRepo(async () => {
    const ref = await resolveBaseRef("HEAD");
    const expected = spawnSync("git", ["rev-parse", "HEAD"]).stdout.toString().trim();
    assert.strictEqual(ref, expected);
  }));

  test("throws on invalid ref", withRepo(async () => {
    await assert.rejects(() => resolveBaseRef("nonexistent-branch-xyz"), /Could not resolve/);
  }));
});

describe("getBaseFileContent", () => {
  test("returns file content from base commit", withRepo(async () => {
    const baseRef = spawnSync("git", ["rev-parse", "HEAD"]).stdout.toString().trim();
    // app.ts exists with "export const x = 1;\n" in the initial commit
    const content = await getBaseFileContent(baseRef, "app.ts");
    assert.strictEqual(content, "export const x = 1;\n");
  }));

  test("returns null for file not in base", withRepo(async () => {
    const baseRef = spawnSync("git", ["rev-parse", "HEAD"]).stdout.toString().trim();
    const content = await getBaseFileContent(baseRef, "nonexistent.ts");
    assert.strictEqual(content, null);
  }));
});

describe("restoreFromManifest", () => {
  test("restores files from manifest", withRepo(async (dir) => {
    // Simulate a crash: manifest says app.ts should be "original content"
    writeFileSync(join(dir, ".brunt-restore"), JSON.stringify({ "app.ts": "original content\n" }));
    writeFileSync(join(dir, "app.ts"), "corrupted content\n");

    const restored = await restoreFromManifest();
    assert.strictEqual(restored, true);
    assert.strictEqual(readFileSync(join(dir, "app.ts"), "utf-8"), "original content\n");
    assert.strictEqual(existsSync(join(dir, ".brunt-restore")), false);
  }));

  test("returns false when no manifest exists", withRepo(async () => {
    const restored = await restoreFromManifest();
    assert.strictEqual(restored, false);
  }));
});
