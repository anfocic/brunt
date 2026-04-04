import { exec } from "./util.js";

export type DiffHunk = {
  added: string[];
  removed: string[];
  context: string[];
  newStart?: number; // starting line number in the new file (from @@ header)
};

export type DiffFile = {
  path: string;
  hunks: DiffHunk[];
  language: string;
};

const LANGUAGE_MAP: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  py: "python",
  rs: "rust",
  go: "go",
  rb: "ruby",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  cs: "csharp",
  cpp: "cpp",
  c: "c",
  php: "php",
};

const IGNORED_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "svg", "ico", "webp",
  "woff", "woff2", "ttf", "eot",
  "lock", "map",
]);

const IGNORED_FILES = new Set([
  "package-lock.json", "yarn.lock", "bun.lockb", "pnpm-lock.yaml",
  "Cargo.lock", "poetry.lock", "Gemfile.lock",
]);

function inferLanguage(path: string): string {
  const ext = path.split(".").pop() ?? "";
  return LANGUAGE_MAP[ext] ?? ext;
}

function shouldIgnore(path: string): boolean {
  const filename = path.split("/").pop() ?? "";
  if (IGNORED_FILES.has(filename)) return true;
  const ext = filename.split(".").pop() ?? "";
  return IGNORED_EXTENSIONS.has(ext);
}

const SENSITIVE_PATTERNS = [
  ".env",
  ".env.*",
  "*secret*",
  "*credential*",
  "*password*",
  "*.pem",
  "*.key",
  "*.p12",
  "id_rsa*",
  "*.keystore",
];

function matchGlob(pattern: string, filename: string): boolean {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  try {
    return new RegExp("^" + escaped + "$", "i").test(filename);
  } catch {
    return false;
  }
}

export function isSensitive(path: string, extraPatterns?: string[]): boolean {
  const filename = path.split("/").pop() ?? "";
  const patterns = [...SENSITIVE_PATTERNS, ...(extraPatterns ?? [])];
  return patterns.some((p) => matchGlob(p, filename));
}

function parseDiff(raw: string): DiffFile[] {
  const files: DiffFile[] = [];
  const fileChunks = raw.split(/^diff --git /m).filter(Boolean);

  for (const chunk of fileChunks) {
    const pathMatch = chunk.match(/^a\/.+? b\/(.+)/);
    if (!pathMatch) continue;

    const path = pathMatch[1]!;
    if (shouldIgnore(path)) continue;

    const hunks: DiffHunk[] = [];
    const hunkHeaders = [...chunk.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/gm)];
    const hunkParts = chunk.split(/^@@[^@]+@@.*$/m).slice(1);

    for (let h = 0; h < hunkParts.length; h++) {
      const hunkRaw = hunkParts[h]!;
      const added: string[] = [];
      const removed: string[] = [];
      const context: string[] = [];

      for (const line of hunkRaw.split("\n")) {
        if (line.startsWith("+")) added.push(line.slice(1));
        else if (line.startsWith("-")) removed.push(line.slice(1));
        else if (line.startsWith(" ")) context.push(line.slice(1));
      }

      if (added.length > 0 || removed.length > 0) {
        const newStart = hunkHeaders[h] ? parseInt(hunkHeaders[h][1]!, 10) : undefined;
        hunks.push({ added, removed, context, newStart });
      }
    }

    if (hunks.length > 0) {
      files.push({ path, hunks, language: inferLanguage(path) });
    }
  }

  return files;
}


export async function getDiff(range: string): Promise<DiffFile[]> {
  const { stdout, stderr, exitCode } = await exec("git", ["diff", range], { maxBuffer: 10 * 1024 * 1024 });

  if (exitCode !== 0) {
    throw new Error(`git diff failed: ${stderr.trim()}`);
  }

  if (!stdout.trim()) {
    return [];
  }

  const files = parseDiff(stdout);

  return files.filter((f) => {
    if (isSensitive(f.path)) {
      console.error(`Excluding sensitive file: ${f.path}`);
      return false;
    }
    return true;
  });
}

