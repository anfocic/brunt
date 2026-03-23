import { describe, test, expect } from "bun:test";
import { shouldFail, formatJson } from "../src/reporter.ts";
import type { Finding, ScanReport } from "../src/vectors/types.ts";
import type { GeneratedTest } from "../src/proof/test-gen.ts";

const makeFinding = (severity: Finding["severity"], file = "test.ts", line = 1): Finding => ({
  file,
  line,
  severity,
  title: `Test ${severity} finding`,
  description: `A ${severity} issue was found.`,
  reproduction: "Call foo() with null",
});

const makeReport = (findings: Finding[], vectorName = "correctness"): ScanReport => ({
  vectors: [{ name: vectorName, findings, duration: 100 }],
  totalFindings: findings.length,
  totalDuration: 150,
});

const makeTest = (finding: Finding): GeneratedTest => ({
  finding,
  filePath: `tests/vigil/${finding.file}-L${finding.line}.test.ts`,
  content: "test('fails', () => expect(true).toBe(false));",
});

describe("shouldFail", () => {
  test("fails when finding meets threshold", () => {
    expect(shouldFail([makeFinding("critical")], "critical")).toBe(true);
    expect(shouldFail([makeFinding("high")], "high")).toBe(true);
    expect(shouldFail([makeFinding("medium")], "medium")).toBe(true);
    expect(shouldFail([makeFinding("low")], "low")).toBe(true);
  });

  test("fails when finding exceeds threshold", () => {
    expect(shouldFail([makeFinding("critical")], "low")).toBe(true);
    expect(shouldFail([makeFinding("high")], "medium")).toBe(true);
  });

  test("passes when findings are below threshold", () => {
    expect(shouldFail([makeFinding("low")], "medium")).toBe(false);
    expect(shouldFail([makeFinding("medium")], "high")).toBe(false);
    expect(shouldFail([makeFinding("low")], "critical")).toBe(false);
  });

  test("passes with no findings", () => {
    expect(shouldFail([], "low")).toBe(false);
  });

  test("fails if any finding meets threshold", () => {
    const findings = [makeFinding("low"), makeFinding("critical")];
    expect(shouldFail(findings, "critical")).toBe(true);
  });
});

describe("formatJson", () => {
  test("produces valid JSON with vector structure", () => {
    const findings = [makeFinding("high", "src/api.ts", 42)];
    const report = makeReport(findings);
    const tests = [makeTest(findings[0])];
    const output = formatJson(report, tests);
    const parsed = JSON.parse(output);

    expect(parsed.totalFindings).toBe(1);
    expect(parsed.vectors.length).toBe(1);
    expect(parsed.vectors[0].name).toBe("correctness");
    expect(parsed.vectors[0].findings[0].file).toBe("src/api.ts");
    expect(parsed.vectors[0].findings[0].severity).toBe("high");
    expect(parsed.vectors[0].findings[0].testFile).toBe("tests/vigil/src/api.ts-L42.test.ts");
  });

  test("returns empty vectors when clean", () => {
    const report = makeReport([]);
    const output = formatJson(report, []);
    const parsed = JSON.parse(output);
    expect(parsed.totalFindings).toBe(0);
    expect(parsed.vectors[0].findings).toEqual([]);
  });

  test("sets testFile to null when no test generated", () => {
    const report = makeReport([makeFinding("low")]);
    const output = formatJson(report, []);
    const parsed = JSON.parse(output);
    expect(parsed.vectors[0].findings[0].testFile).toBeNull();
  });

  test("includes duration in output", () => {
    const report = makeReport([]);
    const output = formatJson(report, []);
    const parsed = JSON.parse(output);
    expect(parsed.totalDuration).toBe(150);
    expect(parsed.vectors[0].duration).toBe(100);
  });

  test("handles multiple vectors", () => {
    const report: ScanReport = {
      vectors: [
        { name: "correctness", findings: [makeFinding("high")], duration: 80 },
        { name: "security", findings: [makeFinding("critical")], duration: 120 },
      ],
      totalFindings: 2,
      totalDuration: 200,
    };
    const output = formatJson(report, []);
    const parsed = JSON.parse(output);
    expect(parsed.totalFindings).toBe(2);
    expect(parsed.vectors.length).toBe(2);
    expect(parsed.vectors[1].name).toBe("security");
  });
});
