import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { RestoreGuard, restoreFromManifest, RESTORE_MANIFEST } from "../restore.js";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

function withTmpDir(fn: (dir: string) => Promise<void>) {
  return async () => {
    const dir = mkdtempSync(join(tmpdir(), "brunt-restore-"));
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

function readManifest(): Record<string, string> {
  return JSON.parse(readFileSync(RESTORE_MANIFEST, "utf-8"));
}

describe("RestoreGuard manifest", () => {
  // Regression: the manifest used to be overwritten on every swap, so a crash
  // during a concurrent multi-file run could only recover the last file and
  // silently lost the rest. It must accumulate every in-flight file.
  test("accumulates multiple in-flight files instead of overwriting", withTmpDir(async () => {
    const guard = new RestoreGuard();
    await guard.register("a.ts", "original A\n");
    await guard.register("b.ts", "original B\n");

    const manifest = readManifest();
    assert.deepStrictEqual(manifest, { "a.ts": "original A\n", "b.ts": "original B\n" });
    assert.strictEqual(guard.size(), 2);
  }));

  test("releasing one file leaves the others in the manifest", withTmpDir(async () => {
    const guard = new RestoreGuard();
    await guard.register("a.ts", "original A\n");
    await guard.register("b.ts", "original B\n");

    await guard.release("a.ts");

    assert.deepStrictEqual(readManifest(), { "b.ts": "original B\n" });
    assert.strictEqual(guard.size(), 1);
  }));

  test("releasing every file removes the manifest", withTmpDir(async () => {
    const guard = new RestoreGuard();
    await guard.register("a.ts", "original A\n");
    await guard.release("a.ts");

    assert.strictEqual(existsSync(RESTORE_MANIFEST), false);
    assert.strictEqual(guard.size(), 0);
  }));

  // The mutation check temporarily reverts a file to its buggy state, which
  // re-registers it. The manifest must keep the FIRST (true original) content.
  test("re-registering a file keeps the first recorded content", withTmpDir(async () => {
    const guard = new RestoreGuard();
    await guard.register("a.ts", "true original\n");
    await guard.register("a.ts", "intermediate swap\n");

    assert.deepStrictEqual(readManifest(), { "a.ts": "true original\n" });
  }));
});

describe("restoreFromManifest", () => {
  test("restores every file recorded in a multi-entry manifest", withTmpDir(async (dir) => {
    writeFileSync(join(dir, RESTORE_MANIFEST), JSON.stringify({
      "a.ts": "original A\n",
      "b.ts": "original B\n",
    }));
    writeFileSync(join(dir, "a.ts"), "clobbered A\n");
    writeFileSync(join(dir, "b.ts"), "clobbered B\n");

    const restored = await restoreFromManifest();

    assert.strictEqual(restored, true);
    assert.strictEqual(readFileSync(join(dir, "a.ts"), "utf-8"), "original A\n");
    assert.strictEqual(readFileSync(join(dir, "b.ts"), "utf-8"), "original B\n");
    assert.strictEqual(existsSync(join(dir, RESTORE_MANIFEST)), false);
  }));

  test("returns false and clears a corrupt manifest", withTmpDir(async (dir) => {
    writeFileSync(join(dir, RESTORE_MANIFEST), "{ not valid json");

    const restored = await restoreFromManifest();

    assert.strictEqual(restored, false);
    assert.strictEqual(existsSync(join(dir, RESTORE_MANIFEST)), false);
  }));

  test("returns false when no manifest exists", withTmpDir(async () => {
    assert.strictEqual(await restoreFromManifest(), false);
  }));
});
