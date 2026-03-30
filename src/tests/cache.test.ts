import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { computeCacheKey, readCache, writeCache } from "../cache.js";
import { rmSync } from "fs";
import type { DiffFile } from "../diff.js";
import type { Vector, VectorReport } from "../vectors/types.js";

const makeDiffFile = (path: string, added: string[]): DiffFile => ({
  path,
  language: "typescript",
  hunks: [{ added, removed: [], context: [] }],
});

const makeVector = (name: string): Vector => ({
  name,
  description: `${name} vector`,
  async analyze() { return []; },
});

const makeReport = (name: string): VectorReport => ({
  name,
  findings: [
    {
      file: "test.ts",
      line: 1,
      severity: "high",
      title: "Test bug",
      description: "A bug",
      reproduction: "call it",
    },
  ],
  duration: 100,
});

describe("computeCacheKey", () => {
  test("produces consistent keys for same input", () => {
    const files = [makeDiffFile("a.ts", ["const x = 1;"])];
    const k1 = computeCacheKey(files, [makeVector("correctness")], "claude-cli");
    const k2 = computeCacheKey(files, [makeVector("correctness")], "claude-cli");
    assert.strictEqual(k1, k2);
  });

  test("different files produce different keys", () => {
    const f1 = [makeDiffFile("a.ts", ["const x = 1;"])];
    const f2 = [makeDiffFile("a.ts", ["const x = 2;"])];
    const k1 = computeCacheKey(f1, [makeVector("correctness")], "claude-cli");
    const k2 = computeCacheKey(f2, [makeVector("correctness")], "claude-cli");
    assert.notStrictEqual(k1, k2);
  });

  test("different vectors produce different keys", () => {
    const files = [makeDiffFile("a.ts", ["const x = 1;"])];
    const k1 = computeCacheKey(files, [makeVector("correctness")], "claude-cli");
    const k2 = computeCacheKey(files, [makeVector("correctness"), makeVector("security")], "claude-cli");
    assert.notStrictEqual(k1, k2);
  });

  test("different providers produce different keys", () => {
    const files = [makeDiffFile("a.ts", ["const x = 1;"])];
    const k1 = computeCacheKey(files, [makeVector("correctness")], "claude-cli");
    const k2 = computeCacheKey(files, [makeVector("correctness")], "ollama");
    assert.notStrictEqual(k1, k2);
  });

  test("different models produce different keys", () => {
    const files = [makeDiffFile("a.ts", ["const x = 1;"])];
    const k1 = computeCacheKey(files, [makeVector("correctness")], "ollama", "llama3");
    const k2 = computeCacheKey(files, [makeVector("correctness")], "ollama", "codellama");
    assert.notStrictEqual(k1, k2);
  });
});

describe("readCache / writeCache", () => {
  const cleanup = () => {
    try {
      rmSync(".brunt-cache", { recursive: true });
    } catch {}
  };

  test("returns null for missing cache", async () => {
    cleanup();
    const result = await readCache("nonexistent");
    assert.strictEqual(result, null);
    cleanup();
  });

  test("round-trips cache entries", async () => {
    cleanup();
    const key = "test-round-trip";
    const reports = [makeReport("correctness")];

    await writeCache(key, reports);
    const cached = await readCache(key);

    assert.notStrictEqual(cached, null);
    assert.strictEqual(cached!.length, 1);
    assert.strictEqual(cached![0].name, "correctness");
    assert.strictEqual(cached![0].findings.length, 1);
    assert.strictEqual(cached![0].findings[0].title, "Test bug");
    cleanup();
  });

  test("returns null for corrupted cache", async () => {
    cleanup();
    const { writeFile, mkdir } = await import("node:fs/promises");
    await mkdir(".brunt-cache", { recursive: true });
    await writeFile(".brunt-cache/bad.json", "not json", "utf-8");

    const result = await readCache("bad");
    assert.strictEqual(result, null);
    cleanup();
  });
});
