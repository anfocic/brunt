import { readFile, writeFile } from "node:fs/promises";
import { execFile, execFileSync } from "node:child_process";
import { resolve, relative, isAbsolute } from "node:path";
import type { Finding } from "../vectors/types.ts";
import type { Provider } from "../providers/types.ts";
import type { GeneratedTest } from "../proof/test-gen.ts";
import { pMap, cleanLlmResponse, findingKey } from "../util.ts";
import { generateDiff } from "../diff-gen.ts";

export type FixVerification = {
  finding: Finding;
  status: "verified" | "failed" | "skipped";
  diff: string;
  testOutput: string;
  attempts: number;
  filePath: string;
};

function buildFixPrompt(
  finding: Finding,
  sourceCode: string,
  testContent: string,
  previousFailure?: string
): string {
  let prompt = `Fix the following bug in the source code. Return the COMPLETE corrected file content.

Bug location: ${finding.file}:${finding.line}
Bug: ${finding.title}
${finding.description}

Reproduction: ${finding.reproduction}

--- CURRENT SOURCE (${finding.file}) ---
${sourceCode}
--- END SOURCE ---

--- PROOF TEST (must pass after fix) ---
${testContent}
--- END TEST ---

Requirements:
- Fix ONLY the described bug — do not change anything else
- Return the complete file content, not a diff
- The proof test above must PASS after your fix is applied
- Preserve all imports, exports, and unrelated code exactly as-is`;

  if (previousFailure) {
    prompt += `

Your previous fix attempt FAILED. Here is the test output:
--- FAILURE OUTPUT ---
${previousFailure}
--- END FAILURE ---

Analyze why the test still fails and provide a corrected fix.`;
  }

  prompt += `

Respond with ONLY the corrected file content, no markdown fences, no explanation.`;

  return prompt;
}

function validateFilePath(filePath: string): void {
  const cwd = process.cwd();
  const resolved = resolve(cwd, filePath);
  const rel = relative(cwd, resolved);
  if (isAbsolute(rel) || rel.startsWith("..")) {
    throw new Error(`Fix path escapes project root: ${filePath}`);
  }
}

async function applyFix(filePath: string, patchedContent: string): Promise<string> {
  validateFilePath(filePath);
  const original = await readFile(filePath, "utf-8");
  await writeFile(filePath, patchedContent, "utf-8");
  return original;
}

async function rollbackFix(filePath: string, originalContent: string): Promise<void> {
  await writeFile(filePath, originalContent, "utf-8");
}

function detectTestRunner(): { cmd: string; args: string[] } {
  const which = (cmd: string): boolean => {
    try {
      execFileSync("which", [cmd], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  };
  try {
    if (which("bun")) return { cmd: "bun", args: ["test"] };
    if (which("npx")) return { cmd: "npx", args: ["vitest", "run"] };
  } catch {}
  return { cmd: "node", args: ["--test"] };
}

async function verifyFix(testFilePath: string): Promise<{ passed: boolean; output: string }> {
  const runner = detectTestRunner();

  return new Promise((resolve) => {
    execFile(
      runner.cmd,
      [...runner.args, testFilePath],
      { timeout: 30_000, maxBuffer: 5 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const output = (stdout ?? "") + "\n" + (stderr ?? "");
        resolve({ passed: !error, output: output.trim() });
      }
    );
  });
}

export { generateDiff } from "../diff-gen.ts";

export async function fixAndVerify(
  finding: Finding,
  test: GeneratedTest,
  provider: Provider,
  maxRetries = 2
): Promise<FixVerification> {
  try {
    validateFilePath(finding.file);
  } catch {
    return {
      finding,
      status: "skipped",
      diff: "",
      testOutput: `Path validation failed: ${finding.file}`,
      attempts: 0,
      filePath: finding.file,
    };
  }

  let sourceCode: string;
  try {
    sourceCode = await readFile(finding.file, "utf-8");
  } catch {
    return {
      finding,
      status: "skipped",
      diff: "",
      testOutput: `Could not read source file: ${finding.file}`,
      attempts: 0,
      filePath: finding.file,
    };
  }

  let previousFailure: string | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const prompt = buildFixPrompt(finding, sourceCode, test.content, previousFailure);
    const raw = await provider.query(prompt);
    const patchedContent = cleanLlmResponse(raw);

    if (!patchedContent || patchedContent.trim() === sourceCode.trim()) {
      previousFailure = "Generated fix was empty or identical to the original.";
      continue;
    }

    const originalContent = await applyFix(finding.file, patchedContent);

    try {
      const result = await verifyFix(test.filePath);

      if (result.passed) {
        const diff = generateDiff(originalContent, patchedContent, finding.file);
        return {
          finding,
          status: "verified",
          diff,
          testOutput: result.output,
          attempts: attempt,
          filePath: finding.file,
        };
      }

      await rollbackFix(finding.file, originalContent);
      previousFailure = result.output.slice(0, 2000);
    } catch (err) {
      await rollbackFix(finding.file, originalContent);
      previousFailure = err instanceof Error ? err.message : String(err);
    }
  }

  return {
    finding,
    status: "failed",
    diff: "",
    testOutput: previousFailure ?? "Max retries exceeded",
    attempts: maxRetries,
    filePath: finding.file,
  };
}

export async function fixAll(
  findings: Finding[],
  tests: GeneratedTest[],
  provider: Provider,
  concurrency = 3,
  maxRetries = 2
): Promise<FixVerification[]> {
  const testMap = new Map<string, GeneratedTest>();
  for (const t of tests) {
    testMap.set(findingKey(t.finding), t);
  }

  const fixable = findings.filter((f) => testMap.has(findingKey(f)));

  const byFile = new Map<string, Finding[]>();
  for (const f of fixable) {
    const arr = byFile.get(f.file) ?? [];
    arr.push(f);
    byFile.set(f.file, arr);
  }

  const fileGroups = [...byFile.values()];

  const results = await pMap(
    fileGroups,
    async (group) => {
      const groupResults: FixVerification[] = [];
      for (const finding of group) {
        const test = testMap.get(findingKey(finding))!;
        groupResults.push(await fixAndVerify(finding, test, provider, maxRetries));
      }
      return groupResults;
    },
    concurrency
  );

  return results.flat();
}
