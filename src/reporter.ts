import { createHash } from "node:crypto";
import type { Finding, Severity, ScanReport } from "./vectors/types.js";
import type { GeneratedTest } from "./proof/test-gen.js";
import type { FixVerification } from "./fix/fix-gen.js";
import { bold, dim, green, red, yellow, cyan, gray } from "@packages/devkit";

const SEVERITY_COLORS: Record<Severity, (s: string) => string> = {
  critical: red,
  high: yellow,
  medium: cyan,
  low: gray,
};
import { findingKey } from "./util.js";

export const VERSION = "0.5.0";

function findingId(vectorName: string, f: Finding): string {
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

export function formatText(report: ScanReport, tests: GeneratedTest[], fixes: FixVerification[] = [], suppressedCount = 0): string {
  if (report.totalFindings === 0) {
    const suffix = suppressedCount > 0
      ? ` ${dim(`(${suppressedCount} suppressed by baseline)`)}`
      : "";
    return `${bold("brunt")} — no issues found.${suffix} ${dim(`(${report.totalDuration}ms)`)}\n`;
  }

  const testMap = new Map<string, GeneratedTest>();
  for (const t of tests) {
    testMap.set(findingKey(t.finding), t);
  }

  const fixMap = new Map<string, FixVerification>();
  for (const f of fixes) {
    fixMap.set(findingKey(f.finding), f);
  }

  let out = `\n${bold("brunt")} — found ${report.totalFindings} issue${report.totalFindings === 1 ? "" : "s"} ${dim(`(${report.totalDuration}ms)`)}\n`;

  for (const vector of report.vectors) {
    if (vector.findings.length === 0) continue;

    out += `\n${bold(`[${vector.name}]`)} ${vector.findings.length} finding${vector.findings.length === 1 ? "" : "s"} ${dim(`(${vector.duration}ms)`)}\n\n`;

    const sorted = [...vector.findings].sort(
      (a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity]
    );

    // Group findings by package if present
    const hasPackages = sorted.some((f) => f.package);
    const byPackage = new Map<string, typeof sorted>();
    if (hasPackages) {
      for (const f of sorted) {
        const pkg = f.package ?? "<root>";
        if (!byPackage.has(pkg)) byPackage.set(pkg, []);
        byPackage.get(pkg)!.push(f);
      }
    } else {
      byPackage.set("", sorted);
    }

    for (const [pkg, findings] of byPackage) {
      if (pkg && hasPackages) {
        out += `  ${dim(`[${pkg}]`)}\n`;
      }

      for (const f of findings) {
        const color = SEVERITY_COLORS[f.severity];
        const key = findingKey(f);
        const fix = fixMap.get(key);

        let badge = "";
        if (fix?.status === "verified") {
          badge = ` ${green("[FIXED]")}`;
        } else if (fix?.status === "failed") {
          badge = ` ${red("[FIX FAILED]")}`;
        }

        out += `  ${color(f.severity.toUpperCase())} ${f.file}:${f.line}${badge}\n`;
        out += `  ${bold(f.title)}\n`;
        out += `  ${f.description}\n`;
        out += `  Reproduction: ${f.reproduction}\n`;

        const test = testMap.get(key);
        if (test) {
          out += `  ${dim(`Test: ${test.filePath}`)}\n`;
        }

        if (fix?.status === "verified" && fix.diff) {
          out += `\n${formatInlineDiff(fix.diff)}`;
        }

        out += "\n";
      }
    }
  }

  out += formatDashboard(report, fixes, suppressedCount);

  return out;
}

function formatInlineDiff(diff: string): string {
  const lines = diff.split("\n");
  let out = `  ${dim("--- fix diff ---")}\n`;
  for (const line of lines) {
    if (line.startsWith("---") || line.startsWith("+++") || line.startsWith("@@")) {
      out += `  ${dim(line)}\n`;
    } else if (line.startsWith("+")) {
      out += `  ${green(line)}\n`;
    } else if (line.startsWith("-")) {
      out += `  ${red(line)}\n`;
    } else if (line.trim()) {
      out += `  ${line}\n`;
    }
  }
  return out;
}

function formatDashboard(report: ScanReport, fixes: FixVerification[], suppressedCount = 0): string {
  const allFindings = report.vectors.flatMap((v) => v.findings);
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of allFindings) counts[f.severity]++;

  const verified = fixes.filter((f) => f.status === "verified").length;
  const failed = fixes.filter((f) => f.status === "failed").length;

  let out = `${dim("\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500")}\n`;

  const parts: string[] = [];
  if (counts.critical) parts.push(SEVERITY_COLORS.critical(`${counts.critical} critical`));
  if (counts.high) parts.push(SEVERITY_COLORS.high(`${counts.high} high`));
  if (counts.medium) parts.push(SEVERITY_COLORS.medium(`${counts.medium} medium`));
  if (counts.low) parts.push(SEVERITY_COLORS.low(`${counts.low} low`));

  out += `  ${parts.join("  ")}`;
  out += `  ${dim("|")}  ${report.totalDuration}ms\n`;

  if (fixes.length > 0) {
    const fixParts: string[] = [];
    if (verified) fixParts.push(green(`${verified} fixed`));
    if (failed) fixParts.push(red(`${failed} unfixed`));
    out += `  ${fixParts.join("  ")}\n`;
  }

  if (suppressedCount > 0) {
    out += `  ${dim(`${suppressedCount} suppressed by baseline`)}\n`;
  }

  out += `${dim("\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500")}\n`;

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

export function formatSarif(report: ScanReport, tests: GeneratedTest[], suppressedCount = 0): string {
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
        ...(f.package ? { properties: { package: f.package } } : {}),
      };
    }),
    ...(suppressedCount > 0
      ? { properties: { baseline: { suppressedCount } } }
      : {}),
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

export function formatJson(report: ScanReport, tests: GeneratedTest[], fixes: FixVerification[] = [], suppressedCount = 0): string {
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
        ...(f.package ? { package: f.package } : {}),
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
      suppressedByBaseline: suppressedCount,
      vectors,
    },
    null,
    2
  );
}

