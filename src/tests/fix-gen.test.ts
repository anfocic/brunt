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

describe("fix minimality guard", () => {
  test("counts changed lines correctly excluding headers", () => {
    const original = "line 1\nline 2\nline 3\nline 4\nline 5\n";
    const patched = "line 1\nline 2 changed\nline 3\nline 4\nline 5\n";
    const diff = generateDiff(original, patched, "test.ts");

    const changedLines = diff.split("\n").filter(
      (l: string) => (l.startsWith("+") || l.startsWith("-")) && !l.startsWith("+++") && !l.startsWith("---")
    ).length;

    // Should count exactly 1 removal + 1 addition = 2
    assert.strictEqual(changedLines, 2);
  });

  test("large rewrite produces many changed lines", () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
    const original = lines.join("\n") + "\n";
    const patched = lines.map((l) => l + " rewritten").join("\n") + "\n";
    const diff = generateDiff(original, patched, "test.ts");

    const changedLines = diff.split("\n").filter(
      (l: string) => (l.startsWith("+") || l.startsWith("-")) && !l.startsWith("+++") && !l.startsWith("---")
    ).length;

    // 20 removals + 20 additions = 40, which exceeds max(10, 21 * 0.5 = 11)
    assert.ok(changedLines > 10, `Expected many changed lines, got ${changedLines}`);
    const sourceLineCount = original.split("\n").length;
    const maxAllowed = Math.max(10, Math.round(sourceLineCount * 0.5));
    assert.ok(changedLines > maxAllowed, `${changedLines} should exceed threshold ${maxAllowed}`);
  });
});

describe("mutation check logic", () => {
  test("test that catches the bug: fails on original, passes on fix", () => {
    // Simulates the mutation check scenario:
    // If test passes on fix AND fails on original → test is valid
    const originalBuggy = "function add(a, b) { return a - b; }\n";
    const fixed = "function add(a, b) { return a + b; }\n";

    // The diff between them should be small (valid fix)
    const diff = generateDiff(originalBuggy, fixed, "math.ts");
    const changedLines = diff.split("\n").filter(
      (l: string) => (l.startsWith("+") || l.startsWith("-")) && !l.startsWith("+++") && !l.startsWith("---")
    ).length;

    // 1 removal + 1 addition = 2 changed lines
    assert.strictEqual(changedLines, 2);
  });

  test("identical original and fix means test cannot distinguish", () => {
    // If original === fix, the mutation check would find that the test
    // passes on both — meaning the test isn't exercising the bug
    const code = "function add(a, b) { return a + b; }\n";
    const diff = generateDiff(code, code, "math.ts");
    assert.ok(!diff.includes("@@"), "No hunks means no actual change");
  });
});

describe("fix-gen exports", () => {
  test("module exports expected functions", async () => {
    const mod = await import("../fix/fix-gen.js");
    assert.strictEqual(typeof mod.fixAndVerify, "function");
    assert.strictEqual(typeof mod.fixAll, "function");
  });
});
