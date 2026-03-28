import { describe, test, expect } from "bun:test";
import { matchFindings, buildConsensus } from "../src/consensus.ts";
import type { Finding, VectorReport } from "../src/vectors/types.ts";

const makeFinding = (
  file: string,
  line: number,
  title: string,
  severity: Finding["severity"] = "high"
): Finding => ({
  file,
  line,
  severity,
  title,
  description: "test",
  reproduction: "test",
});

describe("matchFindings", () => {
  test("matches same file and close line with similar title", () => {
    const a = makeFinding("src/api.ts", 42, "SQL injection in query");
    const b = makeFinding("src/api.ts", 44, "SQL injection vulnerability in query");
    expect(matchFindings(a, b)).toBe(true);
  });

  test("rejects different files", () => {
    const a = makeFinding("src/api.ts", 42, "SQL injection");
    const b = makeFinding("src/auth.ts", 42, "SQL injection");
    expect(matchFindings(a, b)).toBe(false);
  });

  test("rejects lines too far apart", () => {
    const a = makeFinding("src/api.ts", 10, "SQL injection");
    const b = makeFinding("src/api.ts", 50, "SQL injection");
    expect(matchFindings(a, b)).toBe(false);
  });

  test("rejects different titles on same line", () => {
    const a = makeFinding("src/api.ts", 42, "SQL injection");
    const b = makeFinding("src/api.ts", 42, "Missing error handling for null return");
    expect(matchFindings(a, b)).toBe(false);
  });

  test("matches within 5 lines", () => {
    const a = makeFinding("src/api.ts", 40, "Off by one error in loop");
    const b = makeFinding("src/api.ts", 45, "Off by one error in loop boundary");
    expect(matchFindings(a, b)).toBe(true);
  });
});

describe("buildConsensus", () => {
  test("reports confidence based on model agreement", () => {
    const model1: VectorReport[] = [
      { name: "security", findings: [makeFinding("api.ts", 10, "SQL injection")], duration: 100 },
    ];
    const model2: VectorReport[] = [
      { name: "security", findings: [makeFinding("api.ts", 11, "SQL injection vulnerability")], duration: 100 },
    ];

    const reports = new Map([["anthropic", model1], ["ollama", model2]]);
    const result = buildConsensus(reports, ["security"]);

    expect(result.models).toEqual(["anthropic", "ollama"]);
    const confirmed = result.results.filter((r) => r.confirmedBy.length === 2);
    expect(confirmed.length).toBe(1);
    expect(confirmed[0]!.confidence).toBe(1);
  });

  test("reports lower confidence for single-model findings", () => {
    const model1: VectorReport[] = [
      { name: "security", findings: [makeFinding("api.ts", 10, "SQL injection")], duration: 100 },
    ];
    const model2: VectorReport[] = [
      { name: "security", findings: [makeFinding("auth.ts", 50, "Auth bypass")], duration: 100 },
    ];

    const reports = new Map([["anthropic", model1], ["ollama", model2]]);
    const result = buildConsensus(reports, ["security"]);

    expect(result.results.length).toBe(2);
    expect(result.results.every((r) => r.confidence === 0.5)).toBe(true);
  });

  test("handles empty reports", () => {
    const model1: VectorReport[] = [{ name: "security", findings: [], duration: 100 }];
    const model2: VectorReport[] = [{ name: "security", findings: [], duration: 100 }];

    const reports = new Map([["anthropic", model1], ["ollama", model2]]);
    const result = buildConsensus(reports, ["security"]);

    expect(result.results.length).toBe(0);
    expect(result.agreement).toBe(1);
  });

  test("handles multiple vectors", () => {
    const model1: VectorReport[] = [
      { name: "security", findings: [makeFinding("api.ts", 10, "SQL injection")], duration: 100 },
      { name: "correctness", findings: [makeFinding("math.ts", 5, "Off by one")], duration: 100 },
    ];
    const model2: VectorReport[] = [
      { name: "security", findings: [makeFinding("api.ts", 10, "SQL injection")], duration: 100 },
      { name: "correctness", findings: [], duration: 100 },
    ];

    const reports = new Map([["anthropic", model1], ["ollama", model2]]);
    const result = buildConsensus(reports, ["security", "correctness"]);

    expect(result.results.length).toBe(2);
    const sqlResult = result.results.find((r) => r.finding.title.includes("SQL"));
    expect(sqlResult!.confidence).toBe(1);
  });
});
