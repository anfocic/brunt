import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { detectSuspiciousSilence } from "../silence.js";
import type { DiffFile, Finding } from "../vectors/types.js";

function makeDiff(path: string, added: string[]): DiffFile {
  return { path, language: "typescript", hunks: [{ added, removed: [], context: [] }] };
}

function makeFinding(file: string): Finding {
  return { file, line: 1, severity: "high", title: "Bug", description: "A bug", reproduction: "call it" };
}

describe("suspicious silence detection", () => {
  test("flags sensitive file with no findings", () => {
    const files = [makeDiff("auth.ts", [
      "function authenticate(token) {",
      '  if (token === "backdoor") return true;',
      "  return verify(token);",
      "}",
    ])];
    const warnings = detectSuspiciousSilence(files, []);
    assert.ok(warnings.includes("auth.ts"));
  });

  test("flags file with exec() and no findings", () => {
    const files = [makeDiff("run.ts", [
      "import { exec } from 'child_process';",
      "exec(userInput);",
    ])];
    const warnings = detectSuspiciousSilence(files, []);
    assert.ok(warnings.includes("run.ts"));
  });

  test("flags file with SQL and no findings", () => {
    const files = [makeDiff("db.ts", [
      'const result = db.query(`SELECT * FROM users WHERE id = ${userId}`);',
    ])];
    const warnings = detectSuspiciousSilence(files, []);
    assert.ok(warnings.includes("db.ts"));
  });

  test("flags file with crypto and no findings", () => {
    const files = [makeDiff("encrypt.ts", [
      "import crypto from 'crypto';",
      "const key = crypto.randomBytes(16);",
    ])];
    const warnings = detectSuspiciousSilence(files, []);
    assert.ok(warnings.includes("encrypt.ts"));
  });

  test("flags file with password handling and no findings", () => {
    const files = [makeDiff("user.ts", [
      "function setPassword(password: string) {",
      "  db.update({ password });",
      "}",
    ])];
    const warnings = detectSuspiciousSilence(files, []);
    assert.ok(warnings.includes("user.ts"));
  });

  test("does NOT flag sensitive file that HAS findings", () => {
    const files = [makeDiff("auth.ts", [
      "function authenticate(token) { return eval(token); }",
    ])];
    const findings = [makeFinding("auth.ts")];
    const warnings = detectSuspiciousSilence(files, findings);
    assert.strictEqual(warnings.length, 0);
  });

  test("does NOT flag non-sensitive file with no findings", () => {
    const files = [makeDiff("utils.ts", [
      "export function add(a: number, b: number) { return a + b; }",
      "export function greet(name: string) { return `Hello ${name}`; }",
    ])];
    const warnings = detectSuspiciousSilence(files, []);
    assert.strictEqual(warnings.length, 0);
  });

  test("flags only the silent sensitive files in a mixed set", () => {
    const files = [
      makeDiff("math.ts", ["export const PI = 3.14;"]),
      makeDiff("auth.ts", ["function checkAuth(token) { return verify(token); }"]),
      makeDiff("db.ts", ['db.query("SELECT 1");']),
    ];
    const findings = [makeFinding("db.ts")];
    const warnings = detectSuspiciousSilence(files, findings);
    assert.strictEqual(warnings.length, 1);
    assert.ok(warnings.includes("auth.ts"));
  });

  test("flags innerHTML usage with no findings", () => {
    const files = [makeDiff("render.ts", [
      "element.innerHTML = userInput;",
    ])];
    const warnings = detectSuspiciousSilence(files, []);
    assert.ok(warnings.includes("render.ts"));
  });
});
