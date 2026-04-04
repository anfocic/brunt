import type { DiffFile } from "../diff.js";

export function buildDiffSection(files: DiffFile[]): string {
  let out = "";
  for (const file of files) {
    out += `\n--- ${file.path} (${file.language}) ---\n`;
    for (const hunk of file.hunks) {
      if (hunk.removed.length) out += hunk.removed.map((l) => `- ${l}`).join("\n") + "\n";
      if (hunk.added.length) out += hunk.added.map((l) => `+ ${l}`).join("\n") + "\n";
    }
  }
  return out;
}

export function buildContextSection(context: Map<string, string>): string {
  let out = "";
  for (const [path, content] of context) {
    out += `\n--- ${path} (full file) ---\n${content}\n`;
  }
  return out;
}

export const RESPONSE_FORMAT = `Respond with ONLY a JSON array of findings. If there are no issues, respond with an empty array [].
Each finding must have:
- "file": the file path
- "line": approximate line number in the new version
- "severity": one of "low", "medium", "high", "critical"
- "title": short description (under 80 chars)
- "description": detailed explanation of the issue
- "reproduction": a specific input, scenario, or step-by-step to trigger it`;
