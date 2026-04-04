import { readFile, access, mkdir, writeFile, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Finding } from "../vectors/types.js";
import type { Provider } from "@packages/llm";
import { exec, pMap, cleanLlmResponse } from "../util.js";

const RESTORE_MANIFEST = ".brunt-restore";

type TestFramework = {
  name: string;
  extension: string;
  dir: string;
};

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function detectFramework(): Promise<TestFramework> {
  const checks: Array<{ file: string; framework: TestFramework }> = [
    {
      file: "vitest.config.ts",
      framework: { name: "vitest", extension: ".test.ts", dir: "tests/brunt" },
    },
    {
      file: "vitest.config.js",
      framework: { name: "vitest", extension: ".test.ts", dir: "tests/brunt" },
    },
    {
      file: "jest.config.ts",
      framework: { name: "jest", extension: ".test.ts", dir: "__tests__/brunt" },
    },
    {
      file: "jest.config.js",
      framework: { name: "jest", extension: ".test.js", dir: "__tests__/brunt" },
    },
    {
      file: "pytest.ini",
      framework: { name: "pytest", extension: "_test.py", dir: "tests/brunt" },
    },
    {
      file: "Cargo.toml",
      framework: { name: "cargo", extension: "_test.rs", dir: "tests/brunt" },
    },
  ];

  const results = await Promise.all(checks.map(async (check) => ({
    exists: await fileExists(check.file),
    framework: check.framework,
  })));

  const match = results.find((r) => r.exists);
  if (match) return match.framework;

  try {
    const raw = await readFile("package.json", "utf-8");
    const pkg = JSON.parse(raw);
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (deps.vitest) return { name: "vitest", extension: ".test.ts", dir: "tests/brunt" };
    if (deps.jest) return { name: "jest", extension: ".test.ts", dir: "__tests__/brunt" };
    if (deps.mocha) return { name: "mocha", extension: ".test.ts", dir: "test/brunt" };
  } catch {}

  return { name: "node:test", extension: ".test.ts", dir: "tests/brunt" };
}

function buildTestPrompt(finding: Finding, framework: TestFramework): string {
  return `Write a single test file that proves the following bug exists. The test should FAIL when run against the current code, demonstrating the bug.

Test framework: ${framework.name}
Bug location: ${finding.file}:${finding.line}

Bug: ${finding.title}
${finding.description}

Reproduction scenario: ${finding.reproduction}

Requirements:
- Import the relevant function/module from "${finding.file}" (use relative path from ${framework.dir}/)
- Write ONE focused test that demonstrates the bug
- The test should FAIL with the current buggy code
- Include a clear test name that describes what should work but doesn't
- No comments explaining the bug — the test name and assertion should make it obvious

Respond with ONLY the test file content, no markdown fences, no explanation.`;
}

export type GeneratedTest = {
  finding: Finding;
  filePath: string;
  content: string;
};


export async function generateTests(
  findings: Finding[],
  provider: Provider,
  concurrency = 3
): Promise<GeneratedTest[]> {
  const framework = await detectFramework();

  const results = await pMap(
    findings,
    async (finding) => {
      const prompt = buildTestPrompt(finding, framework);
      const content = await provider.query(prompt);
      const cleaned = cleanLlmResponse(content);

      if (!cleaned) {
        console.error(`Warning: failed to generate test for ${finding.file}:${finding.line}, skipping.`);
        return null;
      }

      const safeName = finding.file
        .replace(/[^a-zA-Z0-9]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");

      const filePath = join(framework.dir, `${safeName}-L${finding.line}${framework.extension}`);

      return { finding, filePath, content: cleaned } as GeneratedTest;
    },
    concurrency
  );

  return results.filter((r): r is GeneratedTest => r !== null);
}

export async function writeTests(tests: GeneratedTest[]): Promise<void> {
  for (const test of tests) {
    await mkdir(dirname(test.filePath), { recursive: true });
    await writeFile(test.filePath, test.content, "utf-8");
  }
}

export type VerifyResult = {
  test: GeneratedTest;
  verified: boolean;
  output: string;
};

async function detectTestCommand(filePath: string): Promise<{ cmd: string; args: string[] }> {
  const ext = filePath.split(".").pop() ?? "";

  if (ext === "py") return { cmd: "python", args: ["-m", "pytest", filePath, "-x", "-q"] };
  if (ext === "rs") return { cmd: "cargo", args: ["test", "--", "--test-threads=1"] };

  try {
    const raw = await readFile("package.json", "utf-8");
    const pkg = JSON.parse(raw);
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (deps.vitest) return { cmd: "npx", args: ["vitest", "run", filePath] };
    if (deps.jest) return { cmd: "npx", args: ["jest", filePath, "--no-coverage"] };
  } catch {}

  return { cmd: "node", args: ["--test", filePath] };
}

export async function verifyTests(
  tests: GeneratedTest[],
  concurrency = 3
): Promise<VerifyResult[]> {
  return pMap(
    tests,
    async (test) => {
      const { cmd, args } = await detectTestCommand(test.filePath);
      const result = await exec(cmd, args, { timeout: 30_000 });
      const failed = result.exitCode !== 0;
      return {
        test,
        verified: failed,
        output: (result.stderr || result.stdout).slice(0, 500),
      };
    },
    concurrency
  );
}

// --- Base-branch verification ---

export async function getBaseFileContent(
  baseRef: string,
  filePath: string
): Promise<string | null> {
  const { stdout, exitCode } = await exec("git", ["show", `${baseRef}:${filePath}`]);
  if (exitCode !== 0) return null; // file didn't exist in base
  return stdout;
}

type RestoreManifest = Record<string, string>;

async function writeManifest(manifest: RestoreManifest): Promise<void> {
  await writeFile(RESTORE_MANIFEST, JSON.stringify(manifest), "utf-8");
}

async function clearManifest(): Promise<void> {
  try {
    await unlink(RESTORE_MANIFEST);
  } catch {}
}

/** On startup, check for stale manifest and restore files if found. */
export async function restoreFromManifest(): Promise<boolean> {
  let raw: string;
  try {
    raw = await readFile(RESTORE_MANIFEST, "utf-8");
  } catch {
    return false;
  }

  const manifest: RestoreManifest = JSON.parse(raw);
  for (const [filePath, content] of Object.entries(manifest)) {
    await writeFile(filePath, content, "utf-8");
  }
  await clearManifest();
  return true;
}

export type BaseVerifyResult = {
  test: GeneratedTest;
  kept: boolean; // true = test passes on base (bug is in diff), false = fails on base too
  reason: string;
};

export async function verifyTestsAgainstBase(
  tests: GeneratedTest[],
  baseRef: string,
  concurrency = 3
): Promise<BaseVerifyResult[]> {
  // Check for stale manifest from a previous crash
  const restored = await restoreFromManifest();
  if (restored) {
    console.error("WARNING: Restored files from a previous interrupted base-branch check.");
  }

  // Group tests by finding.file to serialize within each file
  const fileGroups = new Map<string, GeneratedTest[]>();
  for (const test of tests) {
    const file = test.finding.file;
    if (!fileGroups.has(file)) fileGroups.set(file, []);
    fileGroups.get(file)!.push(test);
  }

  const results = new Map<GeneratedTest, BaseVerifyResult>();

  await pMap(
    [...fileGroups.entries()],
    async ([filePath, groupTests]) => {
      // Get base version of this file
      const baseContent = await getBaseFileContent(baseRef, filePath);
      if (baseContent === null) {
        // New file — can't check against base, keep all findings
        for (const test of groupTests) {
          results.set(test, { test, kept: true, reason: "new file (not in base)" });
        }
        return;
      }

      // Read current file content
      let currentContent: string;
      try {
        currentContent = await readFile(filePath, "utf-8");
      } catch {
        for (const test of groupTests) {
          results.set(test, { test, kept: true, reason: "could not read current file" });
        }
        return;
      }

      // Serialize tests within this file group
      for (const test of groupTests) {
        // Write manifest before swapping
        await writeManifest({ [filePath]: currentContent });

        // Register SIGINT handler for this swap
        const onInterrupt = () => {
          const fs = require("node:fs");
          fs.writeFileSync(filePath, currentContent, "utf-8");
          try { fs.unlinkSync(RESTORE_MANIFEST); } catch {}
          process.exit(130);
        };
        process.on("SIGINT", onInterrupt);

        try {
          // Swap in base version
          await writeFile(filePath, baseContent, "utf-8");

          // Run the test against base version
          const { cmd, args } = await detectTestCommand(test.filePath);
          const result = await exec(cmd, args, { timeout: 30_000 });
          const testFailed = result.exitCode !== 0;

          if (testFailed) {
            // Test fails on base too — bug is pre-existing or test is wrong
            results.set(test, { test, kept: false, reason: "test also fails on base branch" });
          } else {
            // Test passes on base — the diff introduced the bug
            results.set(test, { test, kept: true, reason: "test passes on base (bug is in diff)" });
          }
        } finally {
          // Always restore current content
          await writeFile(filePath, currentContent, "utf-8");
          process.removeListener("SIGINT", onInterrupt);
        }
      }

      // All tests for this file done, clear manifest
      await clearManifest();
    },
    concurrency
  );

  // Return in original test order
  return tests.map((t) => results.get(t)!);
}
