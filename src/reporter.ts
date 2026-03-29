import { createHash } from "node:crypto";
import type { Finding, Severity, ScanReport } from "./vectors/types.ts";
import type { GeneratedTest } from "./proof/test-gen.ts";
import type { FixVerification } from "./fix/fix-gen.ts";
import type { ConsensusReport } from "./consensus.ts";
import { RESET, BOLD, DIM, GREEN, RED, YELLOW, SEVERITY_COLORS } from "./colors.ts";
import { findingKey } from "./util.ts";

export const VERSION = "0.4.0";

export function findingId(vectorName: string, f: Finding): string {
  const hash = createHash("sha256")
    .update(`${vectorName}:${f.file}:${f.line}:${f.title}`)
    .digest("hex")
    .slice(0, 12);
  return `brunt/${vectorName}/${hash}`;
}

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

export function formatText(report: ScanReport, tests: GeneratedTest[], fixes: FixVerification[] = []): string {
  if (report.totalFindings === 0) {
    return `${BOLD}brunt${RESET} — no issues found. ${DIM}(${report.totalDuration}ms)${RESET}\n`;
  }

  const testMap = new Map<string, GeneratedTest>();
  for (const t of tests) {
    testMap.set(findingKey(t.finding), t);
  }

  const fixMap = new Map<string, FixVerification>();
  for (const f of fixes) {
    fixMap.set(findingKey(f.finding), f);
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
      const key = findingKey(f);
      const fix = fixMap.get(key);

      let badge = "";
      if (fix?.status === "verified") {
        badge = ` ${GREEN}[FIXED]${RESET}`;
      } else if (fix?.status === "failed") {
        badge = ` ${RED}[FIX FAILED]${RESET}`;
      }

      out += `  ${color}${f.severity.toUpperCase()}${RESET} ${f.file}:${f.line}${badge}\n`;
      out += `  ${BOLD}${f.title}${RESET}\n`;
      out += `  ${f.description}\n`;
      out += `  Reproduction: ${f.reproduction}\n`;

      const test = testMap.get(key);
      if (test) {
        out += `  ${DIM}Test: ${test.filePath}${RESET}\n`;
      }

      if (fix?.status === "verified" && fix.diff) {
        out += `\n${formatInlineDiff(fix.diff)}`;
      }

      out += "\n";
    }
  }

  out += formatDashboard(report, fixes);

  return out;
}

function formatInlineDiff(diff: string): string {
  const lines = diff.split("\n");
  let out = `  ${DIM}--- fix diff ---${RESET}\n`;
  for (const line of lines) {
    if (line.startsWith("---") || line.startsWith("+++") || line.startsWith("@@")) {
      out += `  ${DIM}${line}${RESET}\n`;
    } else if (line.startsWith("+")) {
      out += `  ${GREEN}${line}${RESET}\n`;
    } else if (line.startsWith("-")) {
      out += `  ${RED}${line}${RESET}\n`;
    } else if (line.trim()) {
      out += `  ${line}\n`;
    }
  }
  return out;
}

function formatDashboard(report: ScanReport, fixes: FixVerification[]): string {
  const allFindings = report.vectors.flatMap((v) => v.findings);
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of allFindings) counts[f.severity]++;

  const verified = fixes.filter((f) => f.status === "verified").length;
  const failed = fixes.filter((f) => f.status === "failed").length;

  let out = `${DIM}\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500${RESET}\n`;

  const parts: string[] = [];
  if (counts.critical) parts.push(`${SEVERITY_COLORS.critical}${counts.critical} critical${RESET}`);
  if (counts.high) parts.push(`${SEVERITY_COLORS.high}${counts.high} high${RESET}`);
  if (counts.medium) parts.push(`${SEVERITY_COLORS.medium}${counts.medium} medium${RESET}`);
  if (counts.low) parts.push(`${SEVERITY_COLORS.low}${counts.low} low${RESET}`);

  out += `  ${parts.join("  ")}`;
  out += `  ${DIM}|${RESET}  ${report.totalDuration}ms\n`;

  if (fixes.length > 0) {
    const fixParts: string[] = [];
    if (verified) fixParts.push(`${GREEN}${verified} fixed${RESET}`);
    if (failed) fixParts.push(`${RED}${failed} unfixed${RESET}`);
    out += `  ${fixParts.join("  ")}\n`;
  }

  out += `${DIM}\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500${RESET}\n`;

  return out;
}

function sarifLevel(severity: Severity): "error" | "warning" | "note" {
  switch (severity) {
    case "critical":
    case "high":
      return "error";
    case "medium":
      return "warning";
    case "low":
      return "note";
  }
}

export function formatSarif(report: ScanReport, tests: GeneratedTest[]): string {
  const testMap = new Map<string, GeneratedTest>();
  for (const t of tests) {
    testMap.set(findingKey(t.finding), t);
  }

  const runs = report.vectors.map((vector) => ({
    tool: {
      driver: {
        name: `brunt/${vector.name}`,
        version: VERSION,
        rules: vector.findings.map((f) => ({
          id: findingId(vector.name, f),
          shortDescription: { text: f.title },
          fullDescription: { text: f.description },
          defaultConfiguration: {
            level: sarifLevel(f.severity),
          },
        })),
      },
    },
    results: vector.findings.map((f) => {
      const test = testMap.get(findingKey(f));
      return {
        ruleId: findingId(vector.name, f),
        level: sarifLevel(f.severity),
        message: {
          text: `${f.description}${f.reproduction ? `\n\nReproduction: ${f.reproduction}` : ""}${test ? `\nTest: ${test.filePath}` : ""}`,
        },
        locations: [
          {
            physicalLocation: {
              artifactLocation: {
                uri: f.file,
                uriBaseId: "%SRCROOT%",
              },
              region: {
                startLine: f.line,
              },
            },
          },
        ],
      };
    }),
  }));

  return JSON.stringify(
    {
      $schema:
        "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json",
      version: "2.1.0",
      runs,
    },
    null,
    2
  );
}

export function formatJson(report: ScanReport, tests: GeneratedTest[], fixes: FixVerification[] = []): string {
  const testMap = new Map<string, GeneratedTest>();
  for (const t of tests) {
    testMap.set(findingKey(t.finding), t);
  }

  const fixMap = new Map<string, FixVerification>();
  for (const f of fixes) {
    fixMap.set(findingKey(f.finding), f);
  }

  const vectors = report.vectors.map((v) => ({
    name: v.name,
    duration: v.duration,
    findings: v.findings.map((f) => {
      const test = testMap.get(findingKey(f));
      const fix = fixMap.get(findingKey(f));
      return {
        ...f,
        testFile: test?.filePath ?? null,
        fix: fix
          ? { status: fix.status, attempts: fix.attempts, diff: fix.diff || null }
          : null,
      };
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

export function formatConsensus(consensus: ConsensusReport): string {
  const { results, models, agreement } = consensus;

  let out = `\n${BOLD}Consensus Report${RESET} — ${models.length} model${models.length === 1 ? "" : "s"}: ${models.join(", ")}\n`;
  out += `${DIM}Overall agreement: ${(agreement * 100).toFixed(0)}%${RESET}\n\n`;

  if (results.length === 0) {
    out += `  No findings across any model.\n`;
    return out;
  }

  for (const r of results) {
    const color = SEVERITY_COLORS[r.finding.severity] ?? DIM;
    const badge = r.confirmedBy.length === models.length
      ? `${GREEN}[${r.confirmedBy.length}/${models.length}]${RESET}`
      : `${YELLOW}[${r.confirmedBy.length}/${models.length}]${RESET}`;

    out += `  ${badge} ${color}${r.finding.severity.toUpperCase()}${RESET} ${r.finding.file}:${r.finding.line}\n`;
    out += `  ${BOLD}${r.finding.title}${RESET}\n`;
    out += `  ${DIM}Confirmed by: ${r.confirmedBy.join(", ")}${RESET}\n\n`;
  }

  const confirmed = results.filter((r) => r.confirmedBy.length === models.length).length;
  const partial = results.filter((r) => r.confirmedBy.length > 1 && r.confirmedBy.length < models.length).length;
  const single = results.filter((r) => r.confirmedBy.length === 1).length;

  out += `${DIM}────────────────────────────────────────${RESET}\n`;
  out += `  ${GREEN}${confirmed} confirmed by all${RESET}`;
  if (partial) out += `  ${YELLOW}${partial} partial${RESET}`;
  if (single) out += `  ${DIM}${single} single-model${RESET}`;
  out += "\n";
  out += `${DIM}────────────────────────────────────────${RESET}\n`;

  return out;
}
