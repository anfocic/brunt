import type { Finding, Severity } from "./vectors/correctness.ts";
import type { GeneratedTest } from "./proof/test-gen.ts";

const SEVERITY_COLORS: Record<Severity, string> = {
  critical: "\x1b[31m",  // red
  high: "\x1b[33m",      // yellow
  medium: "\x1b[36m",    // cyan
  low: "\x1b[90m",       // gray
};

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export function shouldFail(findings: Finding[], failOn: Severity): boolean {
  const threshold = SEVERITY_ORDER[failOn];
  return findings.some((f) => SEVERITY_ORDER[f.severity] >= threshold);
}

export function formatText(findings: Finding[], tests: GeneratedTest[]): string {
  if (findings.length === 0) {
    return `${BOLD}vigil${RESET} — no issues found.\n`;
  }

  const testMap = new Map<string, GeneratedTest>();
  for (const t of tests) {
    const key = `${t.finding.file}:${t.finding.line}`;
    testMap.set(key, t);
  }

  let out = `\n${BOLD}vigil${RESET} — found ${findings.length} issue${findings.length === 1 ? "" : "s"}:\n\n`;

  const sorted = [...findings].sort(
    (a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity]
  );

  for (const f of sorted) {
    const color = SEVERITY_COLORS[f.severity];
    out += `  ${color}${f.severity.toUpperCase()}${RESET} ${f.file}:${f.line}\n`;
    out += `  ${BOLD}${f.title}${RESET}\n`;
    out += `  ${f.description}\n`;
    out += `  Reproduction: ${f.reproduction}\n`;

    const test = testMap.get(`${f.file}:${f.line}`);
    if (test) {
      out += `  Test: ${test.filePath}\n`;
    }

    out += "\n";
  }

  return out;
}

export function formatJson(findings: Finding[], tests: GeneratedTest[]): string {
  const results = findings.map((f) => {
    const test = tests.find(
      (t) => t.finding.file === f.file && t.finding.line === f.line
    );
    return {
      ...f,
      testFile: test?.filePath ?? null,
    };
  });

  return JSON.stringify({ findings: results, count: results.length }, null, 2);
}
