import { readFile, stat } from "node:fs/promises";
import type { DiffFile } from "./diff.js";

const MAX_FILE_SIZE = 50 * 1024; // 50KB
const WINDOW_SIZE = 50; // lines above/below each hunk
const HEADER_LINES = 10; // always include first N lines (imports/types)
const SMALL_FILE_THRESHOLD = 200; // send full file if under this many lines

export async function loadContext(files: DiffFile[], packageRoot?: string): Promise<Map<string, string>> {
  const context = new Map<string, string>();

  const reads = files.map(async (file) => {
    try {
      // When scoped to a package, only load context for files within that package
      if (packageRoot && packageRoot !== "." && !file.path.startsWith(packageRoot + "/")) {
        return;
      }

      const info = await stat(file.path);
      if (info.size > MAX_FILE_SIZE) return;

      const content = await readFile(file.path, "utf-8");
      const windowed = windowContext(content, file);
      context.set(file.path, windowed);
    } catch {
      // file might have been deleted in the diff
    }
  });

  await Promise.all(reads);
  return context;
}

export function windowContext(content: string, file: DiffFile): string {
  const lines = content.split("\n");

  // Small files: send everything
  if (lines.length <= SMALL_FILE_THRESHOLD) return content;

  // If no hunk has line numbers, fall back to full content
  const hunkStarts = file.hunks
    .map((h) => h.newStart)
    .filter((s): s is number => s !== undefined);
  if (hunkStarts.length === 0) return content;

  // Build a set of line indices to include
  const include = new Set<number>();

  // Always include the file header (imports, type defs)
  for (let i = 0; i < Math.min(HEADER_LINES, lines.length); i++) {
    include.add(i);
  }

  // Include ±WINDOW_SIZE around each hunk
  for (const hunk of file.hunks) {
    if (hunk.newStart === undefined) continue;
    const hunkLen = hunk.added.length + hunk.context.length;
    const start = Math.max(0, hunk.newStart - 1 - WINDOW_SIZE);
    const end = Math.min(lines.length, hunk.newStart - 1 + hunkLen + WINDOW_SIZE);
    for (let i = start; i < end; i++) {
      include.add(i);
    }
  }

  // Build output with "..." separators for skipped regions
  const sorted = [...include].sort((a, b) => a - b);
  const parts: string[] = [];
  let prevIdx = -1;

  for (const idx of sorted) {
    if (prevIdx !== -1 && idx > prevIdx + 1) {
      parts.push(`... (${idx - prevIdx - 1} lines omitted) ...`);
    }
    parts.push(lines[idx]!);
    prevIdx = idx;
  }

  return parts.join("\n");
}
