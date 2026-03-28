import { readFile, access, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Finding } from "../vectors/types.ts";
import type { Provider } from "../providers/types.ts";

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

  for (const check of checks) {
    if (await fileExists(check.file)) {
      return check.framework;
    }
  }

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

export function cleanLlmOutput(raw: string): string {
  let text = raw;

  text = text.replace(/^```[\w]*\n?/gm, "").replace(/\n?```$/gm, "");

  const lines = text.split("\n");
  const codeStart = lines.findIndex(
    (l) => l.startsWith("import ") || l.startsWith("const ") ||
           l.startsWith("describe(") || l.startsWith("test(") ||
           l.startsWith("it(") || l.startsWith("from ") ||
           l.startsWith("use ") || l.startsWith("#")
  );

  if (codeStart > 0) {
    const preamble = lines.slice(0, codeStart).join("\n").trim();
    const looksLikeChatter = !preamble.includes("import ") && !preamble.includes("require(");
    if (looksLikeChatter) {
      text = lines.slice(codeStart).join("\n");
    }
  }

  const trimmedLines = text.split("\n");
  let lastCodeLine = trimmedLines.length - 1;
  for (let i = trimmedLines.length - 1; i >= 0; i--) {
    const trimmed = trimmedLines[i]!.trim();
    if (trimmed === "" || trimmed.startsWith("//")) continue;
    if (trimmed.endsWith("}") || trimmed.endsWith(";") || trimmed.endsWith(")")) {
      lastCodeLine = i;
      break;
    }
    if (trimmed.match(/^[A-Z]/) && trimmed.includes(" ")) {
      lastCodeLine = i - 1;
    } else {
      break;
    }
  }

  text = trimmedLines.slice(0, lastCodeLine + 1).join("\n");
  const result = text.trim() + "\n";

  if (result.trim().length < 10) {
    return "";
  }

  return result;
}

export type GeneratedTest = {
  finding: Finding;
  filePath: string;
  content: string;
};

async function pMap<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]!);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}

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
      const cleaned = cleanLlmOutput(content);

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

export { pMap };

export async function writeTests(tests: GeneratedTest[]): Promise<void> {
  for (const test of tests) {
    await mkdir(dirname(test.filePath), { recursive: true });
    await writeFile(test.filePath, test.content, "utf-8");
  }
}
