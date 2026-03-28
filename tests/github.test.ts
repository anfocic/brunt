import { describe, test, expect } from "bun:test";
import { buildCommentBody, buildReviewBody } from "../src/github.ts";
import type { Finding, VectorReport } from "../src/vectors/types.ts";

const makeFinding = (severity: Finding["severity"], file = "test.ts", line = 1): Finding => ({
  file,
  line,
  severity,
  title: `Test ${severity} finding`,
  description: `A ${severity} issue was found.`,
  reproduction: "Call foo() with null",
});

const makeVectorReport = (name: string, findings: Finding[]): VectorReport => ({
  name,
  findings,
  duration: 100,
});

describe("buildCommentBody", () => {
  test("includes severity, title, description, reproduction", () => {
    const finding = makeFinding("high", "src/api.ts", 42);
    const body = buildCommentBody(finding, "correctness");

    expect(body).toContain("brunt/correctness");
    expect(body).toContain("HIGH");
    expect(body).toContain(finding.title);
    expect(body).toContain(finding.description);
    expect(body).toContain(finding.reproduction);
  });
});

describe("buildReviewBody", () => {
  test("reports zero issues when clean", () => {
    const reports = [makeVectorReport("correctness", [])];
    const body = buildReviewBody(reports);
    expect(body).toContain("no issues");
  });

  test("summarizes findings by vector", () => {
    const reports = [
      makeVectorReport("correctness", [makeFinding("high")]),
      makeVectorReport("security", [makeFinding("critical"), makeFinding("high")]),
    ];
    const body = buildReviewBody(reports);
    expect(body).toContain("3");
    expect(body).toContain("correctness");
    expect(body).toContain("security");
    expect(body).toContain("1 finding");
    expect(body).toContain("2 findings");
  });

  test("skips vectors with no findings", () => {
    const reports = [
      makeVectorReport("correctness", [makeFinding("high")]),
      makeVectorReport("security", []),
    ];
    const body = buildReviewBody(reports);
    expect(body).toContain("correctness");
    expect(body).not.toContain("security");
  });
});
