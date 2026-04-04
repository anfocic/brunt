import type { DiffFile } from "./diff.js";

export interface InjectionWarning {
  file: string;
  line: string;
  pattern: string;
}

const INJECTION_PATTERNS = [
  /\b(?:ignore|skip|do not|don't|never)\b.*\b(?:bug|issue|finding|vuln|error|flaw|report)/i,
  /\b(?:AI|assistant|model|reviewer|system|claude|gpt|llm)\b.*\b(?:ignore|skip|approve|pass|accept)/i,
  /\b(?:no\s+(?:issue|bug|problem|finding|vulnerability))/i,
  /\bthis (?:code|file|function|module) (?:is|has been) (?:safe|secure|correct|reviewed|approved)/i,
  /\bdo not (?:flag|report|analyze|scan|review)\b/i,
  /\bfocus (?:on|your) (?:other|different)\b/i,
  /\bsystem:\s/i,
  /\bignore (?:previous|above|all) (?:instructions?|rules?|guidelines?)/i,
];

function looksLikeComment(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith("//") || trimmed.startsWith("#") || trimmed.startsWith("/*") || trimmed.startsWith("*");
}

// Patterns targeting the LLM directly — only fire on comments/docs where injection is intentional
const TARGETED_PATTERNS = [
  /\b(?:AI|assistant|model|reviewer|system|claude|gpt|llm)\b.*\b(?:ignore|skip|approve|pass|accept)/i,
  /\bdo not (?:flag|report|analyze|scan|review)\b/i,
  /\bfocus (?:on|your) (?:other|different)\b/i,
  /\bsystem:\s/i,
  /\bignore (?:previous|above|all) (?:instructions?|rules?|guidelines?)/i,
];

export function detectInjection(files: DiffFile[]): InjectionWarning[] {
  const warnings: InjectionWarning[] = [];

  for (const file of files) {
    for (const hunk of file.hunks) {
      for (const line of hunk.added) {
        const isComment = looksLikeComment(line);
        // Comments: check all patterns. Non-comments: only check targeted LLM-specific patterns.
        const patterns = isComment ? INJECTION_PATTERNS : TARGETED_PATTERNS;
        for (const pattern of patterns) {
          if (pattern.test(line)) {
            warnings.push({
              file: file.path,
              line: line.trim().slice(0, 80),
              pattern: pattern.source.slice(0, 40),
            });
            break;
          }
        }
      }
    }
  }

  return warnings;
}
