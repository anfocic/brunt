import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { parseFindings } from "../vectors/parse.js";

describe("parseFindings", () => {
  test("parses valid JSON array", () => {
    const findings = parseFindings(JSON.stringify([
      {
        file: "src/api.ts",
        line: 10,
        severity: "high",
        title: "Null dereference",
        description: "user.name accessed without null check",
        reproduction: "Pass null user object",
      },
    ]), "test");
    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0].file, "src/api.ts");
    assert.strictEqual(findings[0].severity, "high");
  });

  test("parses JSON embedded in markdown", () => {
    const raw = `Here are the findings:

\`\`\`json
[
  {
    "file": "lib.ts",
    "line": 5,
    "severity": "medium",
    "title": "Off by one",
    "description": "Loop iterates one too many times",
    "reproduction": "Array of length 1"
  }
]
\`\`\`

That's all I found.`;
    const findings = parseFindings(raw, "test");
    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0].title, "Off by one");
  });

  test("returns empty array for no JSON", () => {
    assert.deepStrictEqual(parseFindings("No issues found.", "test"), []);
  });

  test("returns empty array for invalid JSON", () => {
    assert.deepStrictEqual(parseFindings("[{broken json}]", "test"), []);
  });

  test("returns empty array for empty array response", () => {
    assert.deepStrictEqual(parseFindings("[]", "test"), []);
  });

  test("rejects findings with wrong field types", () => {
    const raw = JSON.stringify([
      { file: "ok.ts", line: 1, severity: "low", title: "V", description: "D", reproduction: "R" },
      { file: "bad.ts", line: "not a number", severity: "high", title: "B", description: "D", reproduction: "R" },
      { file: "bad2.ts", line: 1, severity: "banana", title: "B", description: "D", reproduction: "R" },
      { file: 123, line: 1, severity: "low", title: "B", description: "D", reproduction: "R" },
    ]);
    const findings = parseFindings(raw, "test");
    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0].file, "ok.ts");
  });

  test("rejects findings with missing fields", () => {
    const raw = JSON.stringify([{ file: "bad.ts" }, { severity: "high" }]);
    assert.deepStrictEqual(parseFindings(raw, "test"), []);
  });

  test("handles multiple valid findings", () => {
    const raw = JSON.stringify([
      { file: "a.ts", line: 1, severity: "critical", title: "A", description: "D", reproduction: "R" },
      { file: "b.ts", line: 2, severity: "low", title: "B", description: "D", reproduction: "R" },
    ]);
    assert.strictEqual(parseFindings(raw, "test").length, 2);
  });

  test("handles LLM preamble before JSON", () => {
    const raw = `I found several issues:\n\n[{"file":"x.ts","line":1,"severity":"high","title":"Bug","description":"Desc","reproduction":"Repro"}]`;
    assert.strictEqual(parseFindings(raw, "test").length, 1);
  });

  test("handles brackets in prose before JSON array", () => {
    const raw = `I checked [all files] and [every function] carefully. Here are the findings:

[{"file":"x.ts","line":1,"severity":"high","title":"Bug","description":"Desc","reproduction":"Repro"}]`;
    const findings = parseFindings(raw, "test");
    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0].file, "x.ts");
  });

  test("picks last JSON array when multiple bracket pairs exist", () => {
    const raw = `The array [1, 2, 3] shows the affected lines.

[{"file":"a.ts","line":5,"severity":"low","title":"Issue","description":"D","reproduction":"R"}]`;
    const findings = parseFindings(raw, "test");
    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0].file, "a.ts");
  });

  test("handles brackets inside JSON string values", () => {
    const raw = JSON.stringify([
      {
        file: "src/api.ts",
        line: 10,
        severity: "high",
        title: "Array [1,2,3] not validated",
        description: "The input array [items] is used without bounds checking",
        reproduction: "Pass array [null, undefined]",
      },
    ]);
    const findings = parseFindings(raw, "test");
    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0].title, "Array [1,2,3] not validated");
  });

  test("handles escaped quotes inside JSON strings", () => {
    const raw = JSON.stringify([
      {
        file: "test.ts",
        line: 1,
        severity: "low",
        title: 'Uses eval("code")',
        description: 'Calls eval with string containing "brackets [and] quotes"',
        reproduction: "Call the function",
      },
    ]);
    const findings = parseFindings(raw, "test");
    assert.strictEqual(findings.length, 1);
  });
});
