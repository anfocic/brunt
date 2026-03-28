import { describe, test, expect, afterEach } from "bun:test";
import { loadContext } from "../src/context.ts";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { DiffFile } from "../src/diff.ts";

function makeDiffFile(path: string): DiffFile {
  return { path, language: "typescript", hunks: [{ added: ["const x = 1;"], removed: [], context: [] }] };
}

describe("loadContext", () => {
  let dir: string;
  let origDir: string;

  function setup() {
    dir = mkdtempSync(join(tmpdir(), "brunt-ctx-"));
    origDir = process.cwd();
    process.chdir(dir);
  }

  afterEach(() => {
    process.chdir(origDir);
    rmSync(dir, { recursive: true });
  });

  test("loads file content into map", async () => {
    setup();
    writeFileSync(join(dir, "app.ts"), "export const x = 1;\n");
    const ctx = await loadContext([makeDiffFile("app.ts")]);
    expect(ctx.size).toBe(1);
    expect(ctx.get("app.ts")).toBe("export const x = 1;\n");
  });

  test("loads multiple files", async () => {
    setup();
    writeFileSync(join(dir, "a.ts"), "a");
    writeFileSync(join(dir, "b.ts"), "b");
    const ctx = await loadContext([makeDiffFile("a.ts"), makeDiffFile("b.ts")]);
    expect(ctx.size).toBe(2);
    expect(ctx.get("a.ts")).toBe("a");
    expect(ctx.get("b.ts")).toBe("b");
  });

  test("returns empty map for no files", async () => {
    setup();
    const ctx = await loadContext([]);
    expect(ctx.size).toBe(0);
  });

  test("skips deleted files gracefully", async () => {
    setup();
    const ctx = await loadContext([makeDiffFile("nonexistent.ts")]);
    expect(ctx.size).toBe(0);
  });

  test("skips files larger than 50KB", async () => {
    setup();
    const bigContent = "x".repeat(51 * 1024);
    writeFileSync(join(dir, "big.ts"), bigContent);
    const ctx = await loadContext([makeDiffFile("big.ts")]);
    expect(ctx.size).toBe(0);
  });

  test("loads files at exactly 50KB", async () => {
    setup();
    const content = "x".repeat(50 * 1024);
    writeFileSync(join(dir, "exact.ts"), content);
    const ctx = await loadContext([makeDiffFile("exact.ts")]);
    expect(ctx.size).toBe(1);
  });
});
