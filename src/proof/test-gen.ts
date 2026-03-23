import type { Finding } from "../vectors/types.ts";
import type { Provider } from "../providers/types.ts";

type TestFramework = {
  name: string;
  extension: string;
  dir: string;
};

async function detectFramework(): Promise<TestFramework> {
  const checks: Array<{ file: string; framework: TestFramework }> = [
    {
      file: "vitest.config.ts",
      framework: { name: "vitest", extension: ".test.ts", dir: "tests/vigil" },
    },
    {
      file: "vitest.config.js",
      framework: { name: "vitest", extension: ".test.ts", dir: "tests/vigil" },
    },
    {
      file: "jest.config.ts",
      framework: { name: "jest", extension: ".test.ts", dir: "__tests__/vigil" },
    },
    {
      file: "jest.config.js",
      framework: { name: "jest", extension: ".test.js", dir: "__tests__/vigil" },
    },
    {
      file: "pytest.ini",
      framework: { name: "pytest", extension: "_test.py", dir: "tests/vigil" },
    },
    {
      file: "pyproject.toml",
      framework: { name: "pytest", extension: "_test.py", dir: "tests/vigil" },
    },
    {
      file: "Cargo.toml",
      framework: { name: "cargo", extension: "_test.rs", dir: "tests/vigil" },
    },
  ];

  for (const check of checks) {
    if (await Bun.file(check.file).exists()) {
      return check.framework;
    }
  }

  // check package.json for test runner hints
  try {
    const pkg = await Bun.file("package.json").json();
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (deps.vitest) return { name: "vitest", extension: ".test.ts", dir: "tests/vigil" };
    if (deps.jest) return { name: "jest", extension: ".test.ts", dir: "__tests__/vigil" };
    if (deps.mocha) return { name: "mocha", extension: ".test.ts", dir: "test/vigil" };
  } catch {}

  // default to bun:test
  return { name: "bun:test", extension: ".test.ts", dir: "tests/vigil" };
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
  provider: Provider
): Promise<GeneratedTest[]> {
  const framework = await detectFramework();
  const tests: GeneratedTest[] = [];

  for (const finding of findings) {
    const prompt = buildTestPrompt(finding, framework);
    const content = await provider.query(prompt);

    // strip markdown fences if the LLM included them anyway
    const cleaned = content
      .replace(/^```[\w]*\n?/gm, "")
      .replace(/```$/gm, "")
      .trim();

    const safeName = finding.file
      .replace(/[^a-zA-Z0-9]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");

    const filePath = `${framework.dir}/${safeName}-L${finding.line}${framework.extension}`;

    tests.push({ finding, filePath, content: cleaned });
  }

  return tests;
}

export async function writeTests(tests: GeneratedTest[]): Promise<void> {
  for (const test of tests) {
    const dir = test.filePath.split("/").slice(0, -1).join("/");
    await Bun.spawn(["mkdir", "-p", dir]).exited;
    await Bun.write(test.filePath, test.content);
  }
}
