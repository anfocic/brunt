import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildCommentBody, buildReviewBody } from "../github.js";
import type { Finding, VectorReport } from "../vectors/types.js";

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

    assert.ok(body.includes("brunt/correctness"));
    assert.ok(body.includes("HIGH"));
    assert.ok(body.includes(finding.title));
    assert.ok(body.includes(finding.description));
    assert.ok(body.includes(finding.reproduction));
  });
});

describe("buildReviewBody", () => {
  test("reports zero issues when clean", () => {
    const reports = [makeVectorReport("correctness", [])];
    const body = buildReviewBody(reports);
    assert.ok(body.includes("no issues"));
  });

  test("summarizes findings by vector", () => {
    const reports = [
      makeVectorReport("correctness", [makeFinding("high")]),
      makeVectorReport("security", [makeFinding("critical"), makeFinding("high")]),
    ];
    const body = buildReviewBody(reports);
    assert.ok(body.includes("3"));
    assert.ok(body.includes("correctness"));
    assert.ok(body.includes("security"));
    assert.ok(body.includes("1 finding"));
    assert.ok(body.includes("2 findings"));
  });

  test("skips vectors with no findings", () => {
    const reports = [
      makeVectorReport("correctness", [makeFinding("high")]),
      makeVectorReport("security", []),
    ];
    const body = buildReviewBody(reports);
    assert.ok(body.includes("correctness"));
    assert.ok(!body.includes("security"));
  });
});
