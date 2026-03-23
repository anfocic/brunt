import { describe, test, expect } from "bun:test";
import { parseFindings } from "../src/vectors/parse.ts";

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
    expect(findings.length).toBe(1);
    expect(findings[0].file).toBe("src/api.ts");
    expect(findings[0].severity).toBe("high");
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
    expect(findings.length).toBe(1);
    expect(findings[0].title).toBe("Off by one");
  });

  test("returns empty array for no JSON", () => {
    expect(parseFindings("No issues found.", "test")).toEqual([]);
  });

  test("returns empty array for invalid JSON", () => {
    expect(parseFindings("[{broken json}]", "test")).toEqual([]);
  });

  test("returns empty array for empty array response", () => {
    expect(parseFindings("[]", "test")).toEqual([]);
  });

  test("rejects findings with wrong field types", () => {
    const raw = JSON.stringify([
      { file: "ok.ts", line: 1, severity: "low", title: "V", description: "D", reproduction: "R" },
      { file: "bad.ts", line: "not a number", severity: "high", title: "B", description: "D", reproduction: "R" },
      { file: "bad2.ts", line: 1, severity: "banana", title: "B", description: "D", reproduction: "R" },
      { file: 123, line: 1, severity: "low", title: "B", description: "D", reproduction: "R" },
    ]);
    const findings = parseFindings(raw, "test");
    expect(findings.length).toBe(1);
    expect(findings[0].file).toBe("ok.ts");
  });

  test("rejects findings with missing fields", () => {
    const raw = JSON.stringify([{ file: "bad.ts" }, { severity: "high" }]);
    expect(parseFindings(raw, "test")).toEqual([]);
  });

  test("handles multiple valid findings", () => {
    const raw = JSON.stringify([
      { file: "a.ts", line: 1, severity: "critical", title: "A", description: "D", reproduction: "R" },
      { file: "b.ts", line: 2, severity: "low", title: "B", description: "D", reproduction: "R" },
    ]);
    expect(parseFindings(raw, "test").length).toBe(2);
  });

  test("handles LLM preamble before JSON", () => {
    const raw = `I found several issues:\n\n[{"file":"x.ts","line":1,"severity":"high","title":"Bug","description":"Desc","reproduction":"Repro"}]`;
    expect(parseFindings(raw, "test").length).toBe(1);
  });
});
