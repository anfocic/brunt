import type { Finding, Severity, ScanReport } from "./vectors/types.ts";
import type { GeneratedTest } from "./proof/test-gen.ts";

const SEVERITY_COLORS: Record<Severity, string> = {
  critical: "\x1b[31m",
  high: "\x1b[33m",
  medium: "\x1b[36m",
  low: "\x1b[90m",
};

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

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

export function formatText(report: ScanReport, tests: GeneratedTest[]): string {
  if (report.totalFindings === 0) {
    return `${BOLD}brunt${RESET} — no issues found. ${DIM}(${report.totalDuration}ms)${RESET}\n`;
  }

  const testMap = new Map<string, GeneratedTest>();
  for (const t of tests) {
    const key = `${t.finding.file}:${t.finding.line}`;
    testMap.set(key, t);
  }

  let out = `\n${BOLD}brunt${RESET} — found ${report.totalFindings} issue${report.totalFindings === 1 ? "" : "s"} ${DIM}(${report.totalDuration}ms)${RESET}\n`;

  for (const vector of report.vectors) {
    if (vector.findings.length === 0) continue;

    out += `\n${BOLD}[${vector.name}]${RESET} ${vector.findings.length} finding${vector.findings.length === 1 ? "" : "s"} ${DIM}(${vector.duration}ms)${RESET}\n\n`;

    const sorted = [...vector.findings].sort(
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
  }

  return out;
}

export function formatJson(report: ScanReport, tests: GeneratedTest[]): string {
  const vectors = report.vectors.map((v) => ({
    name: v.name,
    duration: v.duration,
    findings: v.findings.map((f) => {
      const test = tests.find(
        (t) => t.finding.file === f.file && t.finding.line === f.line
      );
      return { ...f, testFile: test?.filePath ?? null };
    }),
  }));

  return JSON.stringify(
    {
      totalFindings: report.totalFindings,
      totalDuration: report.totalDuration,
      vectors,
    },
    null,
    2
  );
}
