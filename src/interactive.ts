import { createInterface } from "node:readline";
import type { Finding, ScanReport } from "./vectors/types.ts";
import type { GeneratedTest } from "./proof/test-gen.ts";
import type { Provider } from "./providers/types.ts";
import { fixAndVerify, type FixVerification } from "./fix/fix-gen.ts";
import { RESET, BOLD, DIM, GREEN, RED, CYAN, SEVERITY_COLORS } from "./colors.ts";
import { findingKey } from "./util.ts";

export type InteractiveResult = {
  accepted: Finding[];
  dismissed: Finding[];
  fixed: FixVerification[];
};

type FindingState = {
  finding: Finding;
  test?: GeneratedTest;
  status: "pending" | "accepted" | "dismissed" | "fixed";
  fix?: FixVerification;
  explanation?: string;
};

function printFindingsList(states: FindingState[]) {
  process.stderr.write(`\n${BOLD}Findings:${RESET}\n\n`);
  for (let i = 0; i < states.length; i++) {
    const s = states[i]!;
    const color = SEVERITY_COLORS[s.finding.severity] ?? DIM;
    let badge = "";
    if (s.status === "accepted") badge = ` ${GREEN}[accepted]${RESET}`;
    else if (s.status === "dismissed") badge = ` ${DIM}[dismissed]${RESET}`;
    else if (s.status === "fixed") badge = ` ${GREEN}[fixed]${RESET}`;

    process.stderr.write(
      `  ${DIM}${String(i + 1).padStart(2)}.${RESET} ${color}${s.finding.severity.toUpperCase()}${RESET} ${s.finding.file}:${s.finding.line}${badge}\n`
    );
    process.stderr.write(`      ${s.finding.title}\n`);
  }
  process.stderr.write("\n");
}

function printHelp() {
  process.stderr.write(`${BOLD}Commands:${RESET}
  ${CYAN}<number>${RESET}     Select a finding to inspect
  ${CYAN}explain${RESET}      Ask AI to explain the selected finding in detail
  ${CYAN}fix${RESET}          Generate and verify a fix for the selected finding
  ${CYAN}accept${RESET}       Accept the selected finding (mark as real bug)
  ${CYAN}dismiss${RESET}      Dismiss the selected finding (mark as false positive)
  ${CYAN}list${RESET}         Show all findings
  ${CYAN}summary${RESET}      Show current triage summary
  ${CYAN}help${RESET}         Show this help
  ${CYAN}quit${RESET}         Exit interactive mode
\n`);
}

function printDetail(state: FindingState) {
  const f = state.finding;
  const color = SEVERITY_COLORS[f.severity] ?? DIM;
  process.stderr.write(`\n${color}${f.severity.toUpperCase()}${RESET} ${f.file}:${f.line}\n`);
  process.stderr.write(`${BOLD}${f.title}${RESET}\n\n`);
  process.stderr.write(`${f.description}\n\n`);
  process.stderr.write(`${DIM}Reproduction:${RESET} ${f.reproduction}\n`);
  if (state.test) {
    process.stderr.write(`${DIM}Test:${RESET} ${state.test.filePath}\n`);
  }
  if (state.explanation) {
    process.stderr.write(`\n${BOLD}AI Explanation:${RESET}\n${state.explanation}\n`);
  }
  if (state.fix) {
    const fixColor = state.fix.status === "verified" ? GREEN : RED;
    process.stderr.write(`\n${fixColor}Fix: ${state.fix.status}${RESET} (${state.fix.attempts} attempt${state.fix.attempts === 1 ? "" : "s"})\n`);
    if (state.fix.diff) {
      process.stderr.write(`${DIM}${state.fix.diff}${RESET}\n`);
    }
  }
  process.stderr.write("\n");
}

function printSummary(states: FindingState[]) {
  const accepted = states.filter((s) => s.status === "accepted").length;
  const dismissed = states.filter((s) => s.status === "dismissed").length;
  const fixed = states.filter((s) => s.status === "fixed").length;
  const pending = states.filter((s) => s.status === "pending").length;

  process.stderr.write(`\n${BOLD}Triage Summary:${RESET}\n`);
  process.stderr.write(`  ${GREEN}${accepted} accepted${RESET}  ${DIM}${dismissed} dismissed${RESET}  ${GREEN}${fixed} fixed${RESET}  ${pending} pending\n\n`);
}

export async function runInteractive(
  report: ScanReport,
  tests: GeneratedTest[],
  provider: Provider
): Promise<InteractiveResult> {
  const allFindings = report.vectors.flatMap((v) => v.findings);
  const testMap = new Map<string, GeneratedTest>();
  for (const t of tests) {
    testMap.set(findingKey(t.finding), t);
  }

  const states: FindingState[] = allFindings.map((finding) => ({
    finding,
    test: testMap.get(findingKey(finding)),
    status: "pending" as const,
  }));

  let selected: number | null = null;

  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
    terminal: true,
  });

  process.stderr.write(`\n${BOLD}Interactive Mode${RESET} — ${allFindings.length} finding${allFindings.length === 1 ? "" : "s"} to triage\n`);
  printHelp();
  printFindingsList(states);

  const prompt = () => {
    const sel = selected !== null ? ` [${selected + 1}]` : "";
    rl.setPrompt(`${CYAN}brunt${sel}>${RESET} `);
    rl.prompt();
  };

  return new Promise<InteractiveResult>((resolve) => {
    let processing = false;
    prompt();

    rl.on("line", async (line) => {
      if (processing) return;
      processing = true;
      try {
        await handleLine(line);
      } finally {
        processing = false;
      }
    });

    async function handleLine(line: string) {
      const input = line.trim().toLowerCase();

      if (!input) {
        prompt();
        return;
      }

      const num = parseInt(input, 10);
      if (!isNaN(num) && num >= 1 && num <= states.length) {
        selected = num - 1;
        printDetail(states[selected]!);
        prompt();
        return;
      }

      if (input === "list" || input === "ls") {
        printFindingsList(states);
        prompt();
        return;
      }

      if (input === "help" || input === "h" || input === "?") {
        printHelp();
        prompt();
        return;
      }

      if (input === "summary" || input === "status") {
        printSummary(states);
        prompt();
        return;
      }

      if (input === "quit" || input === "q" || input === "exit") {
        rl.close();
        return;
      }

      if (selected === null) {
        process.stderr.write(`${DIM}Select a finding first (type a number).${RESET}\n`);
        prompt();
        return;
      }

      const state = states[selected]!;

      if (input === "accept" || input === "a") {
        state.status = "accepted";
        process.stderr.write(`${GREEN}Finding #${selected + 1} accepted.${RESET}\n`);
        prompt();
        return;
      }

      if (input === "dismiss" || input === "d") {
        state.status = "dismissed";
        process.stderr.write(`${DIM}Finding #${selected + 1} dismissed.${RESET}\n`);
        prompt();
        return;
      }

      if (input === "explain" || input === "e") {
        process.stderr.write(`${DIM}Asking AI to explain...${RESET}\n`);
        try {
          const explanation = await provider.query(
            `Explain this bug in detail. What causes it, what are the consequences, and how would you fix it?

File: ${state.finding.file}:${state.finding.line}
Bug: ${state.finding.title}
${state.finding.description}
Reproduction: ${state.finding.reproduction}

Give a clear, concise explanation (3-5 paragraphs max). No markdown.`
          );
          state.explanation = explanation.trim();
          process.stderr.write(`\n${BOLD}Explanation:${RESET}\n${state.explanation}\n\n`);
        } catch (err) {
          process.stderr.write(`${RED}Failed to get explanation: ${err instanceof Error ? err.message : err}${RESET}\n`);
        }
        prompt();
        return;
      }

      if (input === "fix" || input === "f") {
        if (!state.test) {
          process.stderr.write(`${RED}No proof test available for this finding. Cannot generate fix.${RESET}\n`);
          prompt();
          return;
        }
        process.stderr.write(`${DIM}Generating fix and verifying...${RESET}\n`);
        try {
          const result = await fixAndVerify(state.finding, state.test, provider, 2);
          state.fix = result;
          if (result.status === "verified") {
            state.status = "fixed";
            process.stderr.write(`${GREEN}Fix verified!${RESET}\n`);
            if (result.diff) {
              process.stderr.write(`${DIM}${result.diff}${RESET}\n`);
            }
          } else {
            process.stderr.write(`${RED}Fix could not be verified after ${result.attempts} attempt${result.attempts === 1 ? "" : "s"}.${RESET}\n`);
          }
        } catch (err) {
          process.stderr.write(`${RED}Fix generation failed: ${err instanceof Error ? err.message : err}${RESET}\n`);
        }
        prompt();
        return;
      }

      process.stderr.write(`${DIM}Unknown command: "${input}". Type "help" for commands.${RESET}\n`);
      prompt();
    }

    rl.on("close", () => {
      printSummary(states);

      resolve({
        accepted: states.filter((s) => s.status === "accepted").map((s) => s.finding),
        dismissed: states.filter((s) => s.status === "dismissed").map((s) => s.finding),
        fixed: states.filter((s) => s.fix?.status === "verified").map((s) => s.fix!),
      });
    });
  });
}
