import { describe, test, expect } from "bun:test";
import { computeCacheKey, readCache, writeCache } from "../src/cache.ts";
import { rmSync } from "fs";
import type { DiffFile } from "../src/diff.ts";
import type { VectorReport } from "../src/vectors/types.ts";

const makeDiffFile = (path: string, added: string[]): DiffFile => ({
  path,
  language: "typescript",
  hunks: [{ added, removed: [], context: [] }],
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
    const k1 = computeCacheKey(files, ["correctness"], "claude-cli");
    const k2 = computeCacheKey(files, ["correctness"], "claude-cli");
    expect(k1).toBe(k2);
  });

  test("different files produce different keys", () => {
    const f1 = [makeDiffFile("a.ts", ["const x = 1;"])];
    const f2 = [makeDiffFile("a.ts", ["const x = 2;"])];
    const k1 = computeCacheKey(f1, ["correctness"], "claude-cli");
    const k2 = computeCacheKey(f2, ["correctness"], "claude-cli");
    expect(k1).not.toBe(k2);
  });

  test("different vectors produce different keys", () => {
    const files = [makeDiffFile("a.ts", ["const x = 1;"])];
    const k1 = computeCacheKey(files, ["correctness"], "claude-cli");
    const k2 = computeCacheKey(files, ["correctness", "security"], "claude-cli");
    expect(k1).not.toBe(k2);
  });

  test("different providers produce different keys", () => {
    const files = [makeDiffFile("a.ts", ["const x = 1;"])];
    const k1 = computeCacheKey(files, ["correctness"], "claude-cli");
    const k2 = computeCacheKey(files, ["correctness"], "ollama");
    expect(k1).not.toBe(k2);
  });

  test("different models produce different keys", () => {
    const files = [makeDiffFile("a.ts", ["const x = 1;"])];
    const k1 = computeCacheKey(files, ["correctness"], "ollama", "llama3");
    const k2 = computeCacheKey(files, ["correctness"], "ollama", "codellama");
    expect(k1).not.toBe(k2);
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
    expect(result).toBeNull();
    cleanup();
  });

  test("round-trips cache entries", async () => {
    cleanup();
    const key = "test-round-trip";
    const reports = [makeReport("correctness")];

    await writeCache(key, reports);
    const cached = await readCache(key);

    expect(cached).not.toBeNull();
    expect(cached!.length).toBe(1);
    expect(cached![0].name).toBe("correctness");
    expect(cached![0].findings.length).toBe(1);
    expect(cached![0].findings[0].title).toBe("Test bug");
    cleanup();
  });

  test("returns null for corrupted cache", async () => {
    cleanup();
    const { writeFile, mkdir } = await import("node:fs/promises");
    await mkdir(".brunt-cache", { recursive: true });
    await writeFile(".brunt-cache/bad.json", "not json", "utf-8");

    const result = await readCache("bad");
    expect(result).toBeNull();
    cleanup();
  });
});
