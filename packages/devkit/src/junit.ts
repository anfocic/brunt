import { readFileSync, writeFileSync } from "node:fs";

export interface JUnitSuite {
  name: string;
  tests: JUnitTest[];
  durationSec: number;
}

export interface JUnitTest {
  name: string;
  className: string;
  durationSec: number;
  outcome: "pass" | "fail" | "skip";
  failureMessage?: string;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function buildJunitXml(suites: JUnitSuite[]): string {
  const totalTests = suites.reduce((s, suite) => s + suite.tests.length, 0);
  const totalFailures = suites.reduce(
    (s, suite) => s + suite.tests.filter((t) => t.outcome === "fail").length, 0
  );
  const totalTime = suites.reduce((s, suite) => s + suite.durationSec, 0).toFixed(3);

  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<testsuites tests="${totalTests}" failures="${totalFailures}" time="${totalTime}">\n`;

  for (const suite of suites) {
    const suiteFailures = suite.tests.filter((t) => t.outcome === "fail").length;
    xml += `  <testsuite name="${escapeXml(suite.name)}" tests="${suite.tests.length}" failures="${suiteFailures}" time="${suite.durationSec.toFixed(3)}">\n`;

    for (const t of suite.tests) {
      xml += `    <testcase name="${escapeXml(t.name)}" classname="${escapeXml(t.className)}" time="${t.durationSec.toFixed(3)}">\n`;

      if (t.outcome === "fail") {
        const msg = t.failureMessage || "unknown error";
        xml += `      <failure message="${escapeXml(msg)}">${escapeXml(msg)}</failure>\n`;
      } else if (t.outcome === "skip") {
        xml += `      <skipped/>\n`;
      }

      xml += `    </testcase>\n`;
    }
    xml += `  </testsuite>\n`;
  }

  xml += `</testsuites>\n`;
  return xml;
}

export function writeJunitXml(suites: JUnitSuite[], outputPath: string): void {
  writeFileSync(outputPath, buildJunitXml(suites));
}

function unescapeXml(s: string): string {
  return s
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

function attr(tag: string, name: string): string {
  const re = new RegExp(`${name}="([^"]*)"`);
  const m = tag.match(re);
  return m ? unescapeXml(m[1]) : "";
}

function numAttr(tag: string, name: string): number {
  const v = attr(tag, name);
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

export function parseJunitXml(xml: string): JUnitSuite[] {
  const suites: JUnitSuite[] = [];
  const suiteRe = /<testsuite\b[^>]*>([\s\S]*?)<\/testsuite>/g;
  let suiteMatch: RegExpExecArray | null;

  while ((suiteMatch = suiteRe.exec(xml)) !== null) {
    const suiteTag = suiteMatch[0].slice(0, suiteMatch[0].indexOf(">") + 1);
    const suiteBody = suiteMatch[1];
    const suiteName = attr(suiteTag, "name");
    const suiteDuration = numAttr(suiteTag, "time");

    const tests: JUnitTest[] = [];
    const caseRe = /<testcase\b[^>]*(?:\/>|>([\s\S]*?)<\/testcase>)/g;
    let caseMatch: RegExpExecArray | null;

    while ((caseMatch = caseRe.exec(suiteBody)) !== null) {
      const caseTag = caseMatch[0].slice(0, caseMatch[0].indexOf(">") + 1);
      const caseBody = caseMatch[1] || "";
      const testName = attr(caseTag, "name");
      const className = attr(caseTag, "classname");
      const duration = numAttr(caseTag, "time");

      let outcome: "pass" | "fail" | "skip" = "pass";
      let failureMessage: string | undefined;

      if (/<failure\b/.test(caseBody)) {
        outcome = "fail";
        const fmMatch = caseBody.match(/<failure\b[^>]*message="([^"]*)"[^>]*>/);
        failureMessage = fmMatch ? unescapeXml(fmMatch[1]) : undefined;
        if (!failureMessage) {
          const fBodyMatch = caseBody.match(/<failure[^>]*>([\s\S]*?)<\/failure>/);
          if (fBodyMatch) failureMessage = unescapeXml(fBodyMatch[1].trim());
        }
      } else if (/<skipped/.test(caseBody)) {
        outcome = "skip";
      }

      tests.push({ name: testName, className, durationSec: duration, outcome, failureMessage });
    }

    suites.push({ name: suiteName, tests, durationSec: suiteDuration });
  }

  return suites;
}

export function readJunitXml(filePath: string): JUnitSuite[] {
  const xml = readFileSync(filePath, "utf-8");
  return parseJunitXml(xml);
}
