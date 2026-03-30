import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { shouldFail, formatJson, formatSarif } from "../reporter.js";
import type { Finding, ScanReport } from "../vectors/types.js";
import type { GeneratedTest } from "../proof/test-gen.js";

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
    assert.strictEqual(shouldFail([makeFinding("critical")], "critical"), true);
    assert.strictEqual(shouldFail([makeFinding("high")], "high"), true);
    assert.strictEqual(shouldFail([makeFinding("medium")], "medium"), true);
    assert.strictEqual(shouldFail([makeFinding("low")], "low"), true);
  });

  test("fails when finding exceeds threshold", () => {
    assert.strictEqual(shouldFail([makeFinding("critical")], "low"), true);
    assert.strictEqual(shouldFail([makeFinding("high")], "medium"), true);
  });

  test("passes when findings are below threshold", () => {
    assert.strictEqual(shouldFail([makeFinding("low")], "medium"), false);
    assert.strictEqual(shouldFail([makeFinding("medium")], "high"), false);
    assert.strictEqual(shouldFail([makeFinding("low")], "critical"), false);
  });

  test("passes with no findings", () => {
    assert.strictEqual(shouldFail([], "low"), false);
  });

  test("fails if any finding meets threshold", () => {
    const findings = [makeFinding("low"), makeFinding("critical")];
    assert.strictEqual(shouldFail(findings, "critical"), true);
  });
});

describe("formatJson", () => {
  test("produces valid JSON with vector structure", () => {
    const findings = [makeFinding("high", "src/api.ts", 42)];
    const report = makeReport(findings);
    const tests = [makeTest(findings[0])];
    const output = formatJson(report, tests);
    const parsed = JSON.parse(output);

    assert.strictEqual(parsed.totalFindings, 1);
    assert.strictEqual(parsed.vectors.length, 1);
    assert.strictEqual(parsed.vectors[0].name, "correctness");
    assert.strictEqual(parsed.vectors[0].findings[0].file, "src/api.ts");
    assert.strictEqual(parsed.vectors[0].findings[0].severity, "high");
    assert.strictEqual(parsed.vectors[0].findings[0].testFile, "tests/brunt/src/api.ts-L42.test.ts");
  });

  test("returns empty vectors when clean", () => {
    const report = makeReport([]);
    const output = formatJson(report, []);
    const parsed = JSON.parse(output);
    assert.strictEqual(parsed.totalFindings, 0);
    assert.deepStrictEqual(parsed.vectors[0].findings, []);
  });

  test("sets testFile to null when no test generated", () => {
    const report = makeReport([makeFinding("low")]);
    const output = formatJson(report, []);
    const parsed = JSON.parse(output);
    assert.strictEqual(parsed.vectors[0].findings[0].testFile, null);
  });

  test("includes duration in output", () => {
    const report = makeReport([]);
    const output = formatJson(report, []);
    const parsed = JSON.parse(output);
    assert.strictEqual(parsed.totalDuration, 150);
    assert.strictEqual(parsed.vectors[0].duration, 100);
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
    assert.strictEqual(parsed.totalFindings, 2);
    assert.strictEqual(parsed.vectors.length, 2);
    assert.strictEqual(parsed.vectors[1].name, "security");
  });
});

describe("formatSarif", () => {
  test("produces valid SARIF 2.1.0 structure", () => {
    const findings = [makeFinding("high", "src/api.ts", 42)];
    const report = makeReport(findings);
    const tests = [makeTest(findings[0])];
    const output = formatSarif(report, tests);
    const parsed = JSON.parse(output);

    assert.ok(parsed.$schema.includes("sarif-schema-2.1.0"));
    assert.strictEqual(parsed.version, "2.1.0");
    assert.ok(Array.isArray(parsed.runs));
    assert.strictEqual(parsed.runs.length, 1);
  });

  test("maps findings to SARIF results with locations", () => {
    const findings = [makeFinding("high", "src/api.ts", 42)];
    const report = makeReport(findings);
    const output = formatSarif(report, []);
    const parsed = JSON.parse(output);

    const result = parsed.runs[0].results[0];
    assert.strictEqual(result.level, "error");
    assert.strictEqual(result.locations[0].physicalLocation.artifactLocation.uri, "src/api.ts");
    assert.strictEqual(result.locations[0].physicalLocation.region.startLine, 42);
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
    assert.deepStrictEqual(levels, ["error", "error", "warning", "note"]);
  });

  test("includes test file path in message when present", () => {
    const findings = [makeFinding("high", "src/api.ts", 42)];
    const report = makeReport(findings);
    const tests = [makeTest(findings[0])];
    const parsed = JSON.parse(formatSarif(report, tests));

    assert.ok(parsed.runs[0].results[0].message.text.includes("Test:"));
  });

  test("handles empty findings", () => {
    const report = makeReport([]);
    const parsed = JSON.parse(formatSarif(report, []));

    assert.strictEqual(parsed.runs.length, 1);
    assert.deepStrictEqual(parsed.runs[0].results, []);
    assert.deepStrictEqual(parsed.runs[0].tool.driver.rules, []);
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

    assert.strictEqual(parsed.runs.length, 2);
    assert.strictEqual(parsed.runs[0].tool.driver.name, "brunt/correctness");
    assert.strictEqual(parsed.runs[1].tool.driver.name, "brunt/security");
  });

  test("includes rules in tool driver", () => {
    const findings = [makeFinding("high", "src/api.ts", 42)];
    const report = makeReport(findings);
    const parsed = JSON.parse(formatSarif(report, []));

    const rule = parsed.runs[0].tool.driver.rules[0];
    assert.ok(rule.id.startsWith("brunt/correctness/"));
    assert.ok(rule.id.length > "brunt/correctness/".length);
    assert.strictEqual(rule.shortDescription.text, findings[0].title);
    assert.strictEqual(rule.defaultConfiguration.level, "error");
  });

  test("rule IDs are stable across runs", () => {
    const findings = [makeFinding("high", "src/api.ts", 42)];
    const report = makeReport(findings);
    const parsed1 = JSON.parse(formatSarif(report, []));
    const parsed2 = JSON.parse(formatSarif(report, []));

    assert.strictEqual(parsed1.runs[0].results[0].ruleId, parsed2.runs[0].results[0].ruleId);
    assert.strictEqual(parsed1.runs[0].tool.driver.rules[0].id, parsed2.runs[0].tool.driver.rules[0].id);
  });

  test("rule IDs differ for different findings", () => {
    const report: ScanReport = {
      vectors: [{
        name: "test",
        findings: [makeFinding("high", "a.ts", 1), makeFinding("high", "b.ts", 2)],
        duration: 100,
      }],
      totalFindings: 2,
      totalDuration: 100,
    };
    const parsed = JSON.parse(formatSarif(report, []));
    assert.notStrictEqual(parsed.runs[0].results[0].ruleId, parsed.runs[0].results[1].ruleId);
  });
});
