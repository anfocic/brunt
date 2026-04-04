import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { windowContext } from "../context.js";
import { batchFiles } from "../engine.js";
import type { DiffFile, DiffHunk } from "../diff.js";

function makeHunk(added: string[], newStart?: number): DiffHunk {
  return { added, removed: [], context: [], newStart };
}

function makeDiffFile(path: string, hunks: DiffHunk[]): DiffFile {
  return { path, language: "typescript", hunks };
}

function makeLines(count: number, prefix = "line"): string {
  return Array.from({ length: count }, (_, i) => `${prefix} ${i + 1}`).join("\n");
}

describe("windowContext", () => {
  test("returns full content for small files", () => {
    const content = makeLines(100);
    const file = makeDiffFile("small.ts", [makeHunk(["x"], 50)]);
    assert.strictEqual(windowContext(content, file), content);
  });

  test("returns full content for files at threshold", () => {
    const content = makeLines(200);
    const file = makeDiffFile("threshold.ts", [makeHunk(["x"], 100)]);
    assert.strictEqual(windowContext(content, file), content);
  });

  test("windows large files around hunk", () => {
    const content = makeLines(500);
    const file = makeDiffFile("big.ts", [makeHunk(["x"], 250)]);
    const result = windowContext(content, file);
    const lines = result.split("\n");

    // Should be much smaller than 500 lines
    assert.ok(lines.length < 200, `Expected < 200 lines, got ${lines.length}`);
    // Should contain the omission marker
    assert.ok(result.includes("lines omitted"), "Should show omitted marker");
    // Should contain lines around hunk (line 250)
    assert.ok(result.includes("line 250"), "Should include hunk area");
    // Should include header
    assert.ok(result.includes("line 1"), "Should include file header");
  });

  test("includes header lines for large files", () => {
    const content = makeLines(500);
    const file = makeDiffFile("big.ts", [makeHunk(["x"], 400)]);
    const result = windowContext(content, file);

    // First 10 lines should be present
    for (let i = 1; i <= 10; i++) {
      assert.ok(result.includes(`line ${i}`), `Should include header line ${i}`);
    }
  });

  test("merges overlapping windows", () => {
    const content = makeLines(500);
    // Two hunks close together — their windows overlap
    const file = makeDiffFile("big.ts", [
      makeHunk(["x"], 200),
      makeHunk(["y"], 220),
    ]);
    const result = windowContext(content, file);
    const omissions = (result.match(/lines omitted/g) || []).length;

    // Should only have omissions before the window region and after it, not between the two hunks
    assert.ok(omissions <= 2, `Expected at most 2 omissions, got ${omissions}`);
  });

  test("falls back to full content when no hunk line numbers", () => {
    const content = makeLines(500);
    const file = makeDiffFile("big.ts", [makeHunk(["x"])]);
    assert.strictEqual(windowContext(content, file), content);
  });
});

describe("batchFiles", () => {
  function makeSmallFile(path: string): DiffFile {
    return makeDiffFile(path, [makeHunk(["const x = 1;"], 1)]);
  }

  function makeLargeFile(path: string): DiffFile {
    const lines = Array.from({ length: 200 }, (_, i) => `const v${i} = ${i};`);
    return makeDiffFile(path, [makeHunk(lines, 1)]);
  }

  test("batches small files together", () => {
    const files = [makeSmallFile("a.ts"), makeSmallFile("b.ts"), makeSmallFile("c.ts")];
    const context = new Map<string, string>();
    const batches = batchFiles(files, context);

    // All small files should fit in one batch
    assert.strictEqual(batches.length, 1);
    assert.strictEqual(batches[0].length, 3);
  });

  test("large files go solo", () => {
    const files = [makeLargeFile("big.ts"), makeSmallFile("small.ts")];
    const context = new Map<string, string>();
    // Add large context to make big.ts exceed threshold
    context.set("big.ts", "x".repeat(10000));
    const batches = batchFiles(files, context);

    assert.ok(batches.length >= 2, `Expected >= 2 batches, got ${batches.length}`);
    // The large file should be alone in its batch
    const bigBatch = batches.find((b) => b.some((f) => f.path === "big.ts"))!;
    assert.strictEqual(bigBatch.length, 1);
  });

  test("returns empty array for no files", () => {
    const batches = batchFiles([], new Map());
    assert.strictEqual(batches.length, 0);
  });

  test("single file returns single batch", () => {
    const batches = batchFiles([makeSmallFile("a.ts")], new Map());
    assert.strictEqual(batches.length, 1);
    assert.strictEqual(batches[0].length, 1);
  });

  test("preserves all files across batches", () => {
    const files = Array.from({ length: 20 }, (_, i) => makeSmallFile(`file${i}.ts`));
    const context = new Map<string, string>();
    const batches = batchFiles(files, context);

    const allPaths = batches.flat().map((f) => f.path);
    assert.strictEqual(allPaths.length, 20);
    for (let i = 0; i < 20; i++) {
      assert.ok(allPaths.includes(`file${i}.ts`), `Missing file${i}.ts`);
    }
  });
});
