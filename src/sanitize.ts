import type { DiffFile } from "./diff.ts";

function stripLineComments(line: string, language: string): string {
  if (["python", "ruby"].includes(language)) {
    return line.replace(/#(?!!).*$/, "").trimEnd();
  }
  // C-style single-line comments (JS, TS, Java, Go, Rust, C, C++, etc.)
  // Naive: doesn't handle // inside strings. Good enough to strip injection attempts.
  return line.replace(/\/\/.*$/, "").trimEnd();
}

function stripBlockComments(text: string): string {
  // Remove /* ... */ including multiline
  return text.replace(/\/\*[\s\S]*?\*\//g, "");
}

function stripHtmlComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, "");
}

export function sanitizeDiff(files: DiffFile[]): DiffFile[] {
  return files.map((file) => ({
    ...file,
    hunks: file.hunks.map((hunk) => {
      const cleanAdded = hunk.added.map((line) => {
        let cleaned = stripLineComments(line, file.language);
        cleaned = stripBlockComments(cleaned);
        cleaned = stripHtmlComments(cleaned);
        return cleaned;
      }).filter((line) => line.trim().length > 0);

      const cleanRemoved = hunk.removed.map((line) => {
        let cleaned = stripLineComments(line, file.language);
        cleaned = stripBlockComments(cleaned);
        cleaned = stripHtmlComments(cleaned);
        return cleaned;
      }).filter((line) => line.trim().length > 0);

      return { added: cleanAdded, removed: cleanRemoved, context: hunk.context };
    }),
  }));
}
