import { describe, test, expect } from "bun:test";
import { shouldFail, formatJson, formatSarif } from "../src/reporter.ts";
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
  filePath: `tests/brunt/${finding.file}-L${finding.line}.test.ts`,
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
    expect(parsed.vectors[0].findings[0].testFile).toBe("tests/brunt/src/api.ts-L42.test.ts");
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

describe("formatSarif", () => {
  test("produces valid SARIF 2.1.0 structure", () => {
    const findings = [makeFinding("high", "src/api.ts", 42)];
    const report = makeReport(findings);
    const tests = [makeTest(findings[0])];
    const output = formatSarif(report, tests);
    const parsed = JSON.parse(output);

    expect(parsed.$schema).toContain("sarif-schema-2.1.0");
    expect(parsed.version).toBe("2.1.0");
    expect(parsed.runs).toBeArray();
    expect(parsed.runs.length).toBe(1);
  });

  test("maps findings to SARIF results with locations", () => {
    const findings = [makeFinding("high", "src/api.ts", 42)];
    const report = makeReport(findings);
    const output = formatSarif(report, []);
    const parsed = JSON.parse(output);

    const result = parsed.runs[0].results[0];
    expect(result.level).toBe("error");
    expect(result.locations[0].physicalLocation.artifactLocation.uri).toBe("src/api.ts");
    expect(result.locations[0].physicalLocation.region.startLine).toBe(42);
  });

  test("maps severity to correct SARIF level", () => {
    const report: ScanReport = {
      vectors: [
        {
          name: "test",
          findings: [
            makeFinding("critical", "a.ts", 1),
            makeFinding("high", "b.ts", 2),
            makeFinding("medium", "c.ts", 3),
            makeFinding("low", "d.ts", 4),
          ],
          duration: 100,
        },
      ],
      totalFindings: 4,
      totalDuration: 100,
    };
    const parsed = JSON.parse(formatSarif(report, []));
    const levels = parsed.runs[0].results.map((r: any) => r.level);
    expect(levels).toEqual(["error", "error", "warning", "note"]);
  });

  test("includes test file path in message when present", () => {
    const findings = [makeFinding("high", "src/api.ts", 42)];
    const report = makeReport(findings);
    const tests = [makeTest(findings[0])];
    const parsed = JSON.parse(formatSarif(report, tests));

    expect(parsed.runs[0].results[0].message.text).toContain("Test:");
  });

  test("handles empty findings", () => {
    const report = makeReport([]);
    const parsed = JSON.parse(formatSarif(report, []));

    expect(parsed.runs.length).toBe(1);
    expect(parsed.runs[0].results).toEqual([]);
    expect(parsed.runs[0].tool.driver.rules).toEqual([]);
  });

  test("creates separate run per vector", () => {
    const report: ScanReport = {
      vectors: [
        { name: "correctness", findings: [makeFinding("high")], duration: 80 },
        { name: "security", findings: [makeFinding("critical")], duration: 120 },
      ],
      totalFindings: 2,
      totalDuration: 200,
    };
    const parsed = JSON.parse(formatSarif(report, []));

    expect(parsed.runs.length).toBe(2);
    expect(parsed.runs[0].tool.driver.name).toBe("brunt/correctness");
    expect(parsed.runs[1].tool.driver.name).toBe("brunt/security");
  });

  test("includes rules in tool driver", () => {
    const findings = [makeFinding("high", "src/api.ts", 42)];
    const report = makeReport(findings);
    const parsed = JSON.parse(formatSarif(report, []));

    const rule = parsed.runs[0].tool.driver.rules[0];
    expect(rule.id).toBe("brunt/correctness/0");
    expect(rule.shortDescription.text).toBe(findings[0].title);
    expect(rule.defaultConfiguration.level).toBe("error");
  });
});
