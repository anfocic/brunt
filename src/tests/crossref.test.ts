import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { extractSymbols } from "../crossref.js";
import { buildCrossRefSection } from "../vectors/prompt.js";
import type { DiffFile, DiffHunk } from "../diff.js";
import type { CrossRefMatch } from "../crossref.js";

function makeHunk(added: string[], removed: string[] = []): DiffHunk {
  return { added, removed, context: [] };
}

function makeDiffFile(path: string, hunks: DiffHunk[]): DiffFile {
  return { path, language: "typescript", hunks };
}

describe("extractSymbols", () => {
  test("extracts JS/TS export function names", () => {
    const files = [makeDiffFile("src/api.ts", [
      makeHunk(["export function fetchUser(id: string) {"], []),
    ])];
    const symbols = extractSymbols(files);
    assert.ok(symbols.includes("fetchUser"));
  });

  test("extracts export class names", () => {
    const files = [makeDiffFile("src/db.ts", [
      makeHunk(["export class DatabaseClient {"], []),
    ])];
    const symbols = extractSymbols(files);
    assert.ok(symbols.includes("DatabaseClient"));
  });

  test("extracts export const names", () => {
    const files = [makeDiffFile("src/config.ts", [
      makeHunk(["export const MAX_RETRIES = 5;"], []),
    ])];
    const symbols = extractSymbols(files);
    assert.ok(symbols.includes("MAX_RETRIES"));
  });

  test("extracts export default function", () => {
    const files = [makeDiffFile("src/handler.ts", [
      makeHunk(["export default function handleRequest(req) {"], []),
    ])];
    const symbols = extractSymbols(files);
    assert.ok(symbols.includes("handleRequest"));
  });

  test("extracts Python def at indent 0", () => {
    const files = [makeDiffFile("main.py", [
      makeHunk(["def process_data(items):"], []),
    ])];
    const symbols = extractSymbols(files);
    assert.ok(symbols.includes("process_data"));
  });

  test("extracts Go func names", () => {
    const files = [makeDiffFile("main.go", [
      makeHunk(["func HandleRequest(w http.ResponseWriter, r *http.Request) {"], []),
    ])];
    const symbols = extractSymbols(files);
    assert.ok(symbols.includes("HandleRequest"));
  });

  test("extracts Go method names", () => {
    const files = [makeDiffFile("main.go", [
      makeHunk(["func (s *Server) ListenAndServe() error {"], []),
    ])];
    const symbols = extractSymbols(files);
    assert.ok(symbols.includes("ListenAndServe"));
  });

  test("extracts Rust pub fn names", () => {
    const files = [makeDiffFile("lib.rs", [
      makeHunk(["pub fn calculate_total(items: &[Item]) -> f64 {"], []),
    ])];
    const symbols = extractSymbols(files);
    assert.ok(symbols.includes("calculate_total"));
  });

  test("extracts from removed lines too", () => {
    const files = [makeDiffFile("src/api.ts", [
      makeHunk([], ["export function getUserById(id: string) {"]),
    ])];
    const symbols = extractSymbols(files);
    assert.ok(symbols.includes("getUserById"));
  });

  test("skips symbols shorter than 4 chars", () => {
    const files = [makeDiffFile("src/api.ts", [
      makeHunk(["export function foo() {"], []),
    ])];
    const symbols = extractSymbols(files);
    assert.ok(!symbols.includes("foo"));
  });

  test("deduplicates symbols", () => {
    const files = [makeDiffFile("src/api.ts", [
      makeHunk(
        ["export function fetchUser(id: string): User | null {"],
        ["export function fetchUser(id: string): User {"]
      ),
    ])];
    const symbols = extractSymbols(files);
    const count = symbols.filter((s) => s === "fetchUser").length;
    assert.strictEqual(count, 1);
  });

  test("caps at MAX_SYMBOLS (8)", () => {
    const lines = Array.from({ length: 20 }, (_, i) =>
      `export function functionNumber${i.toString().padStart(2, "0")}() {}`
    );
    const files = [makeDiffFile("big.ts", [makeHunk(lines)])];
    const symbols = extractSymbols(files);
    assert.ok(symbols.length <= 8);
  });

  test("returns empty for no declarations", () => {
    const files = [makeDiffFile("src/api.ts", [
      makeHunk(["const x = 1;", "console.log(x);"], []),
    ])];
    const symbols = extractSymbols(files);
    assert.strictEqual(symbols.length, 0);
  });

  test("extracts export type/interface names", () => {
    const files = [makeDiffFile("src/types.ts", [
      makeHunk([
        "export type UserResponse = {",
        "export interface DatabaseConfig {",
      ]),
    ])];
    const symbols = extractSymbols(files);
    assert.ok(symbols.includes("UserResponse"));
    assert.ok(symbols.includes("DatabaseConfig"));
  });
});

describe("buildCrossRefSection", () => {
  test("returns empty string for no matches", () => {
    assert.strictEqual(buildCrossRefSection([]), "");
  });

  test("formats matches with file, line, symbol, and snippet", () => {
    const matches: CrossRefMatch[] = [
      { file: "src/handler.ts", line: 42, symbol: "fetchUser", snippet: "const user = await fetchUser(id);" },
    ];
    const section = buildCrossRefSection(matches);
    assert.ok(section.includes("src/handler.ts:42"));
    assert.ok(section.includes("uses: fetchUser"));
    assert.ok(section.includes("const user = await fetchUser(id);"));
  });

  test("includes multiple matches", () => {
    const matches: CrossRefMatch[] = [
      { file: "a.ts", line: 10, symbol: "func1", snippet: "func1()" },
      { file: "b.ts", line: 20, symbol: "func2", snippet: "func2()" },
    ];
    const section = buildCrossRefSection(matches);
    assert.ok(section.includes("a.ts:10"));
    assert.ok(section.includes("b.ts:20"));
  });
});
