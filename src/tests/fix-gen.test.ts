import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { generateDiff } from "../diff-gen.js";

describe("generateDiff", () => {
  test("produces unified diff for single line change", () => {
    const original = "line 1\nline 2\nline 3\nline 4\nline 5\n";
    const patched = "line 1\nline 2\nline 3 fixed\nline 4\nline 5\n";
    const diff = generateDiff(original, patched, "test.ts");

    assert.ok(diff.includes("--- a/test.ts"));
    assert.ok(diff.includes("+++ b/test.ts"));
    assert.ok(diff.includes("-line 3"));
    assert.ok(diff.includes("+line 3 fixed"));
  });

  test("returns empty diff body for identical files", () => {
    const content = "line 1\nline 2\n";
    const diff = generateDiff(content, content, "test.ts");
    assert.ok(diff.includes("--- a/test.ts"));
    assert.ok(!diff.includes("@@"));
  });

  test("handles added lines", () => {
    const original = "line 1\nline 2\n";
    const patched = "line 1\nnew line\nline 2\n";
    const diff = generateDiff(original, patched, "test.ts");
    assert.ok(diff.includes("+new line"));
  });

  test("handles removed lines", () => {
    const original = "line 1\nold line\nline 2\n";
    const patched = "line 1\nline 2\n";
    const diff = generateDiff(original, patched, "test.ts");
    assert.ok(diff.includes("-old line"));
  });

  test("includes context lines around changes", () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`);
    const original = lines.join("\n") + "\n";
    const patched = lines.map((l, i) => (i === 5 ? "CHANGED" : l)).join("\n") + "\n";
    const diff = generateDiff(original, patched, "test.ts");
    assert.ok(diff.includes("@@"));
    assert.ok(diff.includes("-line 6"));
    assert.ok(diff.includes("+CHANGED"));
  });
});

describe("fix-gen exports", () => {
  test("module exports expected functions", async () => {
    const mod = await import("../fix/fix-gen.js");
    assert.strictEqual(typeof mod.fixAndVerify, "function");
    assert.strictEqual(typeof mod.fixAll, "function");
  });
});
