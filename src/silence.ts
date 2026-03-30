import type { DiffFile, Finding } from "./vectors/types.js";

const SENSITIVE_PATTERNS = [
  /\bexec\s*\(/,
  /\bspawn\s*\(/,
  /\beval\s*\(/,
  /\bFunction\s*\(/,
  /\bchild_process\b/,
  /\b(?:sql|query|prepare)\s*[(`]/i,
  /\bSELECT\b.*\bFROM\b/i,
  /\bINSERT\b.*\bINTO\b/i,
  /\.(?:innerHTML|outerHTML)\s*=/,
  /dangerouslySetInnerHTML/,
  /\b(?:authenticate|authorize|verifyToken|checkAuth|isAdmin)\b/,
  /\b(?:password|secret|token|apiKey|api_key|credential)\b/i,
  /\bcrypto\b/,
  /\b(?:readFile|writeFile|unlink|rmdir)\s*\(/,
  /\bopen\s*\(.*['"]w/,
];

function isSensitiveFile(file: DiffFile): boolean {
  for (const hunk of file.hunks) {
    for (const line of [...hunk.added, ...hunk.removed]) {
      if (SENSITIVE_PATTERNS.some((p) => p.test(line))) return true;
    }
  }
  return false;
}

export function detectSuspiciousSilence(
  files: DiffFile[],
  findings: Finding[]
): string[] {
  const filesWithFindings = new Set(findings.map((f) => f.file));
  const warnings: string[] = [];

  for (const file of files) {
    if (filesWithFindings.has(file.path)) continue;
    if (isSensitiveFile(file)) {
      warnings.push(file.path);
    }
  }

  return warnings;
}
