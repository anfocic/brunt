import { describe, test, expect } from "bun:test";
import { generateDiff } from "../src/diff-gen.ts";

describe("generateDiff", () => {
  test("produces unified diff for single line change", () => {
    const original = "line 1\nline 2\nline 3\nline 4\nline 5\n";
    const patched = "line 1\nline 2\nline 3 fixed\nline 4\nline 5\n";
    const diff = generateDiff(original, patched, "test.ts");

    expect(diff).toContain("--- a/test.ts");
    expect(diff).toContain("+++ b/test.ts");
    expect(diff).toContain("-line 3");
    expect(diff).toContain("+line 3 fixed");
  });

  test("returns empty diff body for identical files", () => {
    const content = "line 1\nline 2\n";
    const diff = generateDiff(content, content, "test.ts");
    expect(diff).toContain("--- a/test.ts");
    expect(diff).not.toContain("@@");
  });

  test("handles added lines", () => {
    const original = "line 1\nline 2\n";
    const patched = "line 1\nnew line\nline 2\n";
    const diff = generateDiff(original, patched, "test.ts");
    expect(diff).toContain("+new line");
  });

  test("handles removed lines", () => {
    const original = "line 1\nold line\nline 2\n";
    const patched = "line 1\nline 2\n";
    const diff = generateDiff(original, patched, "test.ts");
    expect(diff).toContain("-old line");
  });

  test("includes context lines around changes", () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`);
    const original = lines.join("\n") + "\n";
    const patched = lines.map((l, i) => (i === 5 ? "CHANGED" : l)).join("\n") + "\n";
    const diff = generateDiff(original, patched, "test.ts");
    expect(diff).toContain("@@");
    expect(diff).toContain("-line 6");
    expect(diff).toContain("+CHANGED");
  });
});

describe("fix-gen exports", () => {
  test("module exports expected functions", async () => {
    const mod = await import("../src/fix/fix-gen.ts");
    expect(typeof mod.generateDiff).toBe("function");
    expect(typeof mod.fixAndVerify).toBe("function");
    expect(typeof mod.fixAll).toBe("function");
  });
});
