import { execFile } from "node:child_process";
import type { Finding } from "./vectors/types.ts";

export function exec(
  cmd: string,
  args: string[],
  opts?: { cwd?: string; timeout?: number; maxBuffer?: number }
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { ...opts, encoding: "utf-8" }, (error, stdout, stderr) => {
      resolve({
        stdout: stdout ?? "",
        stderr: stderr ?? "",
        exitCode: error ? 1 : 0,
      });
    });
  });
}

export async function pMap<T, R>(
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

export function findingKey(f: Finding): string {
  return `${f.file}\0${f.line}\0${f.title}`;
}

export function tokenize(text: string): Set<string> {
  return new Set(
    text.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean)
  );
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

const CODE_STARTERS = [
  "import ", "const ", "let ", "var ", "function ", "class ", "export ",
  "describe(", "test(", "it(", "from ", "use ", "#", "pub ", "def ",
  "package ", "module ", "async ", "type ", "interface ",
];

function looksLikeCode(line: string): boolean {
  return CODE_STARTERS.some((s) => line.startsWith(s));
}

function looksLikeChatter(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed === "") return true;
  return !!(trimmed.match(/^[A-Z]/) && trimmed.includes(" ") && !trimmed.includes("(") && !trimmed.includes("=") && !trimmed.includes("{"));
}

export function cleanLlmResponse(raw: string): string {
  let text = raw;

  text = text.replace(/^```[\w]*\n?/gm, "").replace(/\n?```$/gm, "");

  const lines = text.split("\n");

  let start = 0;
  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    if (looksLikeCode(lines[i]!)) break;
    if (looksLikeChatter(lines[i]!)) {
      start = i + 1;
    } else {
      break;
    }
  }

  let end = lines.length;
  for (let i = lines.length - 1; i >= start; i--) {
    const trimmed = lines[i]!.trim();
    if (trimmed === "" || trimmed.startsWith("//")) {
      end = i;
      continue;
    }
    if (trimmed.endsWith("}") || trimmed.endsWith(";") || trimmed.endsWith(")")) {
      end = i + 1;
      break;
    }
    if (looksLikeChatter(trimmed)) {
      end = i;
    } else {
      end = i + 1;
      break;
    }
  }

  const result = lines.slice(start, end).join("\n").trim();
  return result.length >= 10 ? result + "\n" : "";
}
