import type { DiffFile } from "./diff.js";
import { exec } from "./util.js";

const MAX_SYMBOLS = 8;
const MAX_MATCHES = 20;
const MIN_SYMBOL_LENGTH = 4;
const CONTEXT_LINES = 3;
const GREP_TIMEOUT = 3000;
const MAX_CROSSREF_CHARS = 6000; // ~1500 tokens

// Language-aware patterns for exported/public symbol declarations
const SYMBOL_PATTERNS: RegExp[] = [
  // JS/TS: export function/class/const/type/interface/enum
  /export\s+(?:default\s+)?(?:function|class|const|let|var|type|interface|enum)\s+(\w+)/,
  // JS/TS: export { name }
  /export\s+\{\s*(\w+)/,
  // JS/TS: module.exports.name or module.exports = name
  /module\.exports\.(\w+)/,
  // Python: def/class at indent 0
  /^(?:def|class)\s+(\w+)/,
  // Go: func Name or func (r Type) Name
  /^func\s+(?:\([^)]+\)\s+)?(\w+)/,
  // Rust: pub fn/struct/enum/trait
  /pub\s+(?:fn|struct|enum|trait)\s+(\w+)/,
  // Ruby: def name at indent 0
  /^def\s+(\w+)/,
  // Java/Kotlin: public/protected class/interface/void/etc
  /(?:public|protected)\s+(?:static\s+)?(?:class|interface|void|int|String|boolean|\w+)\s+(\w+)\s*[\({]/,
];

export type CrossRefMatch = {
  file: string;
  line: number;
  snippet: string;
  symbol: string;
};

export type CrossRefResult = {
  symbols: string[];
  matches: CrossRefMatch[];
};

export function extractSymbols(files: DiffFile[]): string[] {
  const symbols = new Set<string>();

  for (const file of files) {
    for (const hunk of file.hunks) {
      // Look at both added and removed lines for changed declarations
      const allLines = [...hunk.added, ...hunk.removed];
      for (const line of allLines) {
        for (const pattern of SYMBOL_PATTERNS) {
          const match = line.match(pattern);
          if (match?.[1] && match[1].length >= MIN_SYMBOL_LENGTH) {
            symbols.add(match[1]);
          }
        }
      }
    }
  }

  return [...symbols].slice(0, MAX_SYMBOLS);
}

export async function findCrossReferences(
  symbols: string[],
  changedFiles: Set<string>,
  packageRoot?: string
): Promise<CrossRefMatch[]> {
  if (symbols.length === 0) return [];

  const matches: CrossRefMatch[] = [];

  // When scoped to a package, restrict git grep to that package's directory
  const pathSpecs = packageRoot && packageRoot !== "."
    ? [`${packageRoot}/**/*.ts`, `${packageRoot}/**/*.js`, `${packageRoot}/**/*.tsx`, `${packageRoot}/**/*.jsx`, `${packageRoot}/**/*.py`, `${packageRoot}/**/*.go`, `${packageRoot}/**/*.rs`, `${packageRoot}/**/*.rb`, `${packageRoot}/**/*.java`, `${packageRoot}/**/*.kt`]
    : ["*.ts", "*.js", "*.tsx", "*.jsx", "*.py", "*.go", "*.rs", "*.rb", "*.java", "*.kt"];

  for (const symbol of symbols) {
    if (matches.length >= MAX_MATCHES) break;

    const { stdout, exitCode } = await exec(
      "git",
      ["grep", "-n", "--max-count=5", "-w", symbol, "--", ...pathSpecs],
      { timeout: GREP_TIMEOUT }
    );

    if (exitCode !== 0 || !stdout.trim()) continue;

    for (const line of stdout.trim().split("\n")) {
      if (matches.length >= MAX_MATCHES) break;

      const colonIdx = line.indexOf(":");
      const secondColon = line.indexOf(":", colonIdx + 1);
      if (colonIdx < 0 || secondColon < 0) continue;

      const file = line.slice(0, colonIdx);
      const lineNum = parseInt(line.slice(colonIdx + 1, secondColon), 10);

      // Skip the file that defines the symbol
      if (changedFiles.has(file)) continue;
      // Skip test files
      if (file.includes("test") || file.includes("spec") || file.includes("__tests__")) continue;

      if (isNaN(lineNum)) continue;

      matches.push({ file, line: lineNum, snippet: "", symbol });
    }
  }

  return matches;
}

export async function loadSnippets(matches: CrossRefMatch[]): Promise<CrossRefMatch[]> {
  const { readFile } = await import("node:fs/promises");
  const loaded: CrossRefMatch[] = [];
  const seenFiles = new Map<string, string[]>();
  let totalChars = 0;

  for (const match of matches) {
    if (totalChars >= MAX_CROSSREF_CHARS) break;

    let lines: string[];
    if (seenFiles.has(match.file)) {
      lines = seenFiles.get(match.file)!;
    } else {
      try {
        const content = await readFile(match.file, "utf-8");
        lines = content.split("\n");
        seenFiles.set(match.file, lines);
      } catch {
        continue;
      }
    }

    const start = Math.max(0, match.line - 1 - CONTEXT_LINES);
    const end = Math.min(lines.length, match.line + CONTEXT_LINES);
    const snippet = lines.slice(start, end).join("\n");

    if (totalChars + snippet.length > MAX_CROSSREF_CHARS) break;

    totalChars += snippet.length;
    loaded.push({ ...match, snippet });
  }

  return loaded;
}

export async function loadCrossReferences(files: DiffFile[], packageRoot?: string): Promise<CrossRefMatch[]> {
  const symbols = extractSymbols(files);
  if (symbols.length === 0) return [];

  const changedFiles = new Set(files.map((f) => f.path));
  const matches = await findCrossReferences(symbols, changedFiles, packageRoot);
  if (matches.length === 0) return [];

  return loadSnippets(matches);
}
