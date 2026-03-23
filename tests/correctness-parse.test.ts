import { describe, test, expect } from "bun:test";

function parseFindings(raw: string) {
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(
      (f: any) =>
        typeof f === "object" &&
        f !== null &&
        "file" in f &&
        "line" in f &&
        "severity" in f &&
        "title" in f &&
        "description" in f &&
        "reproduction" in f
    );
  } catch {
    return [];
  }
}

describe("correctness response parsing", () => {
  test("parses valid JSON array", () => {
    const raw = JSON.stringify([
      {
        file: "src/api.ts",
        line: 10,
        severity: "high",
        title: "Null dereference",
        description: "user.name accessed without null check",
        reproduction: "Pass null user object",
      },
    ]);
    const findings = parseFindings(raw);
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
    const findings = parseFindings(raw);
    expect(findings.length).toBe(1);
    expect(findings[0].title).toBe("Off by one");
  });

  test("returns empty array for no JSON", () => {
    expect(parseFindings("No issues found in this code.")).toEqual([]);
  });

  test("returns empty array for invalid JSON", () => {
    expect(parseFindings("[{broken json}]")).toEqual([]);
  });

  test("returns empty array for empty array response", () => {
    expect(parseFindings("[]")).toEqual([]);
  });

  test("filters out malformed findings", () => {
    const raw = JSON.stringify([
      {
        file: "ok.ts",
        line: 1,
        severity: "low",
        title: "Valid",
        description: "This is valid",
        reproduction: "Do X",
      },
      { file: "bad.ts" },
      { severity: "high" },
    ]);
    const findings = parseFindings(raw);
    expect(findings.length).toBe(1);
    expect(findings[0].file).toBe("ok.ts");
  });

  test("handles multiple valid findings", () => {
    const raw = JSON.stringify([
      { file: "a.ts", line: 1, severity: "critical", title: "A", description: "D", reproduction: "R" },
      { file: "b.ts", line: 2, severity: "low", title: "B", description: "D", reproduction: "R" },
    ]);
    expect(parseFindings(raw).length).toBe(2);
  });

  test("handles LLM preamble before JSON", () => {
    const raw = `I found several issues:\n\n[{"file":"x.ts","line":1,"severity":"high","title":"Bug","description":"Desc","reproduction":"Repro"}]`;
    expect(parseFindings(raw).length).toBe(1);
  });
});
