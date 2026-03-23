import type { DiffFile } from "../diff.ts";
import type { Provider } from "../providers/types.ts";
import type { Vector, Finding } from "./types.ts";

function buildPrompt(files: DiffFile[], context: Map<string, string>): string {
  let diffSection = "";
  for (const file of files) {
    diffSection += `\n--- ${file.path} (${file.language}) ---\n`;
    for (const hunk of file.hunks) {
      if (hunk.removed.length) diffSection += hunk.removed.map((l) => `- ${l}`).join("\n") + "\n";
      if (hunk.added.length) diffSection += hunk.added.map((l) => `+ ${l}`).join("\n") + "\n";
    }
  }

  let contextSection = "";
  for (const [path, content] of context) {
    contextSection += `\n--- ${path} (full file) ---\n${content}\n`;
  }

  return `You are an adversarial code reviewer. Your job is to find correctness bugs in the following code changes. Think like someone trying to break this code.

Focus on:
- Edge cases that will cause runtime errors (null, undefined, empty arrays, zero division)
- Off-by-one errors in loops or slicing
- Type coercion bugs
- Missing error handling that will cause silent failures
- Logic errors where the code does not match obvious intent
- Race conditions or async bugs
- Incorrect boundary conditions

Do NOT report:
- Style issues, naming, or formatting
- Missing comments or documentation
- Performance suggestions unless they cause correctness issues
- Security issues (that's a different vector)
- Hypothetical issues that require unlikely preconditions

DIFF (lines starting with + are added, - are removed):
${diffSection}

FULL FILE CONTEXT:
${contextSection}

Respond with ONLY a JSON array of findings. If there are no issues, respond with an empty array [].
Each finding must have:
- "file": the file path
- "line": approximate line number in the new version
- "severity": one of "low", "medium", "high", "critical"
- "title": short description (under 80 chars)
- "description": detailed explanation of the bug
- "reproduction": a specific input or scenario that triggers the bug

Example:
[
  {
    "file": "src/utils.ts",
    "line": 42,
    "severity": "high",
    "title": "parseInt without radix or NaN check",
    "description": "parseInt('abc') returns NaN which propagates silently through the calculation, eventually causing the response to contain NaN values.",
    "reproduction": "Call parseUserId('abc') - returns NaN instead of throwing"
  }
]

JSON array:`;
}

function parseFindings(raw: string): Finding[] {
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(
      (f: unknown): f is Finding =>
        typeof f === "object" &&
        f !== null &&
        "file" in f &&
        "line" in f &&
        "severity" in f &&
        "title" in f &&
        "description" in f &&
        "reproduction" in f
    );
  } catch {
    return [];
  }
}

export const correctness: Vector = {
  name: "correctness",
  description: "Finds edge cases, off-by-one errors, null handling, type coercion, and logic bugs",

  async analyze(files, context, provider) {
    if (files.length === 0) return [];

    const prompt = buildPrompt(files, context);
    const response = await provider.query(prompt);
    return parseFindings(response);
  },
};
