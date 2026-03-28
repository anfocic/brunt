import type { DiffFile } from "./diff.ts";
import type { Finding } from "./vectors/types.ts";
import type { Provider } from "./providers/types.ts";
import { randomBytes } from "node:crypto";

export type Canary = {
  file: string;
  line: number;
  keyword: string;
};

const CANARY_BUGS = [
  (id: string) => ({
    code: `function __check_${id}(input) { return eval(input); }`,
    keyword: `__check_${id}`,
  }),
  (id: string) => ({
    code: `function __proc_${id}(x) { return x.toString().split("")[0].toUpperCase(); }`,
    keyword: `__proc_${id}`,
  }),
  (id: string) => ({
    code: `function __parse_${id}(v) { return parseInt(v) / 0; }`,
    keyword: `__parse_${id}`,
  }),
];

export function injectCanary(files: DiffFile[]): { files: DiffFile[]; canary: Canary } {
  const id = randomBytes(4).toString("hex");
  const template = CANARY_BUGS[Math.floor(Math.random() * CANARY_BUGS.length)]!;
  const { code, keyword } = template(id);

  // Pick a real file to blend in with, or create a synthetic one
  const hostFile = files.length > 0 ? files[0]! : null;
  const canaryFile = hostFile
    ? hostFile.path.replace(/\.[^.]+$/, `.canary${hostFile.path.match(/\.[^.]+$/)?.[0] ?? ".ts"}`)
    : `src/__canary_${id}.ts`;

  const canaryDiff: DiffFile = {
    path: canaryFile,
    language: hostFile?.language ?? "typescript",
    hunks: [{ added: [code], removed: [], context: [] }],
  };

  return {
    files: [...files, canaryDiff],
    canary: { file: canaryFile, line: 1, keyword },
  };
}

export function verifyCanary(findings: Finding[], canary: Canary): boolean {
  return findings.some(
    (f) => f.file === canary.file || f.title.includes(canary.keyword) || f.description.includes(canary.keyword)
  );
}

export async function verifyCanaryWithLlm(
  canary: Canary,
  findings: Finding[],
  provider: Provider
): Promise<boolean> {
  const findingsSummary = findings
    .map((f) => `- [${f.file}:${f.line}] ${f.title}`)
    .join("\n");

  const prompt = `You are a verification system. A synthetic canary bug was injected into a code review to test if the analysis is working correctly.

The canary bug was:
- File: ${canary.file}
- Keyword: ${canary.keyword}
- Line: ${canary.line}

The following findings were reported by the analysis:
${findingsSummary || "(no findings)"}

Was the canary bug detected in the findings above? Answer ONLY "yes" or "no".`;

  const response = await provider.query(prompt);
  return response.trim().toLowerCase().startsWith("yes");
}
