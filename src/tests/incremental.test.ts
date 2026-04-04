import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  computeFileHash,
  loadIncrementalState,
  saveIncrementalState,
  isStateCompatible,
  partitionFiles,
  mergeFindings,
  buildState,
  type IncrementalState,
  type PerFileFinding,
} from "../incremental.js";
import type { DiffFile, Finding, VectorReport } from "../vectors/types.js";

function makeDiffFile(path: string, added: string[] = ["const x = 1;"]): DiffFile {
  return {
    path,
    language: path.split(".").pop() ?? "",
    hunks: [{ added, removed: [], context: [] }],
  };
}

function makeFinding(file: string, title: string): Finding {
  return {
    file,
    line: 1,
    severity: "medium",
    title,
    description: "desc",
    reproduction: "repro",
  };
}

describe("computeFileHash", () => {
  test("produces stable hash for identical input", () => {
    const file = makeDiffFile("src/index.ts");
    const hash1 = computeFileHash(file);
    const hash2 = computeFileHash(file);
    assert.strictEqual(hash1, hash2);
  });

  test("produces different hash when hunks change", () => {
    const file1 = makeDiffFile("src/index.ts", ["const x = 1;"]);
    const file2 = makeDiffFile("src/index.ts", ["const x = 2;"]);
    assert.notStrictEqual(computeFileHash(file1), computeFileHash(file2));
  });

  test("produces different hash for different paths", () => {
    const file1 = makeDiffFile("src/a.ts");
    const file2 = makeDiffFile("src/b.ts");
    assert.notStrictEqual(computeFileHash(file1), computeFileHash(file2));
  });

  test("returns 24-char hex string", () => {
    const hash = computeFileHash(makeDiffFile("src/index.ts"));
    assert.strictEqual(hash.length, 24);
    assert.match(hash, /^[0-9a-f]+$/);
  });
});

describe("loadIncrementalState / saveIncrementalState", () => {
  test("round-trips state to disk", async () => {
    const dir = mkdtempSync(join(tmpdir(), "brunt-inc-"));
    const path = join(dir, "state.json");

    const state: IncrementalState = {
      version: 1,
      provider: "anthropic",
      model: "sonnet",
      vectors: ["correctness", "security"],
      files: {
        "src/index.ts": {
          contentHash: "abc123",
          findings: [],
          scannedAt: new Date().toISOString(),
        },
      },
      updatedAt: new Date().toISOString(),
    };

    await saveIncrementalState(state, path);
    const loaded = await loadIncrementalState(path);

    assert.ok(loaded);
    assert.strictEqual(loaded.provider, "anthropic");
    assert.strictEqual(loaded.model, "sonnet");
    assert.deepStrictEqual(loaded.vectors, ["correctness", "security"]);
    assert.ok(loaded.files["src/index.ts"]);
  });

  test("returns null for missing file", async () => {
    const result = await loadIncrementalState("/nonexistent/path.json");
    assert.strictEqual(result, null);
  });

  test("returns null for wrong version", async () => {
    const dir = mkdtempSync(join(tmpdir(), "brunt-inc-"));
    const path = join(dir, "state.json");
    writeFileSync(path, JSON.stringify({ version: 999, files: {} }));

    const result = await loadIncrementalState(path);
    assert.strictEqual(result, null);
  });

  test("returns null for corrupt JSON", async () => {
    const dir = mkdtempSync(join(tmpdir(), "brunt-inc-"));
    const path = join(dir, "state.json");
    writeFileSync(path, "not json");

    const result = await loadIncrementalState(path);
    assert.strictEqual(result, null);
  });
});

describe("isStateCompatible", () => {
  const baseState: IncrementalState = {
    version: 1,
    provider: "anthropic",
    model: "sonnet",
    vectors: ["correctness", "security"],
    files: {},
    updatedAt: new Date().toISOString(),
  };

  test("returns true for matching config", () => {
    assert.ok(isStateCompatible(baseState, "anthropic", "sonnet", ["correctness", "security"]));
  });

  test("returns true regardless of vector order", () => {
    assert.ok(isStateCompatible(baseState, "anthropic", "sonnet", ["security", "correctness"]));
  });

  test("returns false when provider changes", () => {
    assert.ok(!isStateCompatible(baseState, "openai", "sonnet", ["correctness", "security"]));
  });

  test("returns false when model changes", () => {
    assert.ok(!isStateCompatible(baseState, "anthropic", "opus", ["correctness", "security"]));
  });

  test("returns false when vectors change", () => {
    assert.ok(!isStateCompatible(baseState, "anthropic", "sonnet", ["correctness"]));
  });

  test("handles undefined model correctly", () => {
    const stateNoModel: IncrementalState = { ...baseState, model: undefined };
    assert.ok(isStateCompatible(stateNoModel, "anthropic", undefined, ["correctness", "security"]));
    assert.ok(!isStateCompatible(stateNoModel, "anthropic", "sonnet", ["correctness", "security"]));
  });
});

describe("partitionFiles", () => {
  test("separates unchanged and changed files", () => {
    const fileA = makeDiffFile("src/a.ts", ["const a = 1;"]);
    const fileB = makeDiffFile("src/b.ts", ["const b = 2;"]);

    const state: IncrementalState = {
      version: 1,
      provider: "anthropic",
      vectors: ["correctness"],
      files: {
        "src/a.ts": {
          contentHash: computeFileHash(fileA),
          findings: [{ vector: "correctness", finding: makeFinding("src/a.ts", "bug in a") }],
          scannedAt: new Date().toISOString(),
        },
      },
      updatedAt: new Date().toISOString(),
    };

    const result = partitionFiles([fileA, fileB], state);

    assert.strictEqual(result.unchanged.length, 1);
    assert.strictEqual(result.unchanged[0]!.path, "src/a.ts");
    assert.strictEqual(result.changed.length, 1);
    assert.strictEqual(result.changed[0]!.path, "src/b.ts");
    assert.strictEqual(result.carriedFindings.length, 1);
    assert.strictEqual(result.carriedFindings[0]!.finding.title, "bug in a");
  });

  test("marks file as changed when hash differs", () => {
    const fileA = makeDiffFile("src/a.ts", ["const a = CHANGED;"]);

    const state: IncrementalState = {
      version: 1,
      provider: "anthropic",
      vectors: ["correctness"],
      files: {
        "src/a.ts": {
          contentHash: "old-hash-that-wont-match",
          findings: [{ vector: "correctness", finding: makeFinding("src/a.ts", "old bug") }],
          scannedAt: new Date().toISOString(),
        },
      },
      updatedAt: new Date().toISOString(),
    };

    const result = partitionFiles([fileA], state);

    assert.strictEqual(result.changed.length, 1);
    assert.strictEqual(result.unchanged.length, 0);
    assert.strictEqual(result.carriedFindings.length, 0);
  });

  test("all files changed on empty state", () => {
    const files = [makeDiffFile("src/a.ts"), makeDiffFile("src/b.ts")];

    const state: IncrementalState = {
      version: 1,
      provider: "anthropic",
      vectors: ["correctness"],
      files: {},
      updatedAt: new Date().toISOString(),
    };

    const result = partitionFiles(files, state);

    assert.strictEqual(result.changed.length, 2);
    assert.strictEqual(result.unchanged.length, 0);
  });
});

describe("mergeFindings", () => {
  test("combines carried findings with new findings", () => {
    const newReports: VectorReport[] = [
      { name: "correctness", findings: [makeFinding("src/b.ts", "new bug")], duration: 100 },
    ];
    const carried: PerFileFinding[] = [
      { vector: "correctness", finding: makeFinding("src/a.ts", "old bug") },
    ];
    const currentFiles = [makeDiffFile("src/a.ts"), makeDiffFile("src/b.ts")];

    const merged = mergeFindings(newReports, carried, currentFiles);

    assert.strictEqual(merged.length, 1);
    assert.strictEqual(merged[0]!.findings.length, 2);
    assert.ok(merged[0]!.findings.some((f) => f.title === "old bug"));
    assert.ok(merged[0]!.findings.some((f) => f.title === "new bug"));
  });

  test("drops carried findings for files no longer in diff", () => {
    const newReports: VectorReport[] = [
      { name: "correctness", findings: [], duration: 100 },
    ];
    const carried: PerFileFinding[] = [
      { vector: "correctness", finding: makeFinding("src/removed.ts", "stale bug") },
    ];
    const currentFiles = [makeDiffFile("src/a.ts")];

    const merged = mergeFindings(newReports, carried, currentFiles);

    assert.strictEqual(merged[0]!.findings.length, 0);
  });

  test("handles multiple vectors", () => {
    const newReports: VectorReport[] = [
      { name: "correctness", findings: [makeFinding("src/b.ts", "corr bug")], duration: 50 },
      { name: "security", findings: [makeFinding("src/b.ts", "sec bug")], duration: 50 },
    ];
    const carried: PerFileFinding[] = [
      { vector: "correctness", finding: makeFinding("src/a.ts", "old corr") },
      { vector: "security", finding: makeFinding("src/a.ts", "old sec") },
    ];
    const currentFiles = [makeDiffFile("src/a.ts"), makeDiffFile("src/b.ts")];

    const merged = mergeFindings(newReports, carried, currentFiles);

    assert.strictEqual(merged.length, 2);
    assert.strictEqual(merged[0]!.name, "correctness");
    assert.strictEqual(merged[0]!.findings.length, 2);
    assert.strictEqual(merged[1]!.name, "security");
    assert.strictEqual(merged[1]!.findings.length, 2);
  });
});

describe("buildState", () => {
  test("creates state with per-file hashes and findings", () => {
    const files = [makeDiffFile("src/a.ts"), makeDiffFile("src/b.ts")];
    const reports: VectorReport[] = [
      { name: "correctness", findings: [makeFinding("src/a.ts", "bug")], duration: 100 },
    ];

    const state = buildState("anthropic", "sonnet", ["correctness"], files, reports);

    assert.strictEqual(state.version, 1);
    assert.strictEqual(state.provider, "anthropic");
    assert.strictEqual(state.model, "sonnet");
    assert.deepStrictEqual(state.vectors, ["correctness"]);
    assert.ok(state.files["src/a.ts"]);
    assert.ok(state.files["src/b.ts"]);
    assert.strictEqual(state.files["src/a.ts"]!.findings.length, 1);
    assert.strictEqual(state.files["src/b.ts"]!.findings.length, 0);
    assert.strictEqual(state.files["src/a.ts"]!.contentHash, computeFileHash(files[0]!));
  });
});
