import { readFile, access, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Finding } from "../vectors/types.js";
import type { Provider } from "@packages/llm";
import { exec, pMap, cleanLlmResponse } from "../util.js";

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
      const result = await exec(cmd, args, { timeout: 30_000, maxBuffer: 1024 * 1024 });
      const output = (result.stderr || result.stdout).slice(0, 500);
      // Only count as verified if the test runner actually ran and the test failed.
      // Timeouts, missing commands, syntax errors, and module resolution failures are NOT proof of a bug.
      const isInfraFailure = result.timedOut ||
        result.exitCode === 127 ||
        /SyntaxError|Cannot find module|ERR_MODULE_NOT_FOUND|ERR_UNKNOWN_FILE_EXTENSION/.test(output);
      const failed = result.exitCode !== 0 && !isInfraFailure;
      return {
        test,
        verified: failed,
        output,
      };
    },
    concurrency
  );
}
