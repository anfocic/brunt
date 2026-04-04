import { readFile, writeFile, realpath } from "node:fs/promises";
import { execFile, execFileSync } from "node:child_process";
import { resolve, relative, isAbsolute } from "node:path";
import type { Finding } from "../vectors/types.js";
import type { Provider } from "@packages/llm";
import type { GeneratedTest } from "../proof/test-gen.js";
import { pMap, cleanLlmResponse, findingKey } from "../util.js";
import { generateDiff } from "../diff-gen.js";

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

async function validateFilePath(filePath: string): Promise<void> {
  const cwd = process.cwd();
  const resolved = resolve(cwd, filePath);
  const rel = relative(cwd, resolved);
  if (isAbsolute(rel) || rel.startsWith("..")) {
    throw new Error(`Fix path escapes project root: ${filePath}`);
  }
  // Resolve symlinks to prevent symlink traversal attacks
  try {
    const realResolved = await realpath(resolved);
    const realCwd = await realpath(cwd);
    if (!realResolved.startsWith(realCwd + "/") && realResolved !== realCwd) {
      throw new Error(`Fix path escapes project root via symlink: ${filePath}`);
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("escapes project root")) throw err;
    // File doesn't exist yet — path validation above is sufficient
  }
}

async function applyFix(filePath: string, patchedContent: string): Promise<string> {
  await validateFilePath(filePath);
  const original = await readFile(filePath, "utf-8");
  await writeFile(filePath, patchedContent, "utf-8");
  return original;
}

async function rollbackFix(filePath: string, originalContent: string): Promise<void> {
  await writeFile(filePath, originalContent, "utf-8");
}

let cachedTestRunner: { cmd: string; args: string[] } | undefined;

function detectTestRunner(): { cmd: string; args: string[] } {
  if (cachedTestRunner) return cachedTestRunner;

  const which = (cmd: string): boolean => {
    try {
      execFileSync("which", [cmd], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  };
  try {
    if (which("bun")) {
      cachedTestRunner = { cmd: "bun", args: ["test"] };
      return cachedTestRunner;
    }
    if (which("npx")) {
      cachedTestRunner = { cmd: "npx", args: ["vitest", "run"] };
      return cachedTestRunner;
    }
  } catch {}
  cachedTestRunner = { cmd: "node", args: ["--test"] };
  return cachedTestRunner;
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

export async function fixAndVerify(
  finding: Finding,
  test: GeneratedTest,
  provider: Provider,
  maxRetries = 2
): Promise<FixVerification> {
  try {
    await validateFilePath(finding.file);
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

    // Guard against LLM returning wildly different content
    const sizeDelta = Math.abs(patchedContent.length - sourceCode.length);
    if (sizeDelta > sourceCode.length * 0.5 && sizeDelta > 500) {
      previousFailure = "Generated fix changed more than 50% of the file — likely hallucinated.";
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
