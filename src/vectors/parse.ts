import type { Finding, Severity } from "./types.js";

const VALID_SEVERITIES: Set<string> = new Set(["low", "medium", "high", "critical"]);

function extractJsonArray(raw: string): string | null {
  let depth = 0;
  let lastStart = -1;
  let lastEnd = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === "\\" && inString) {
      escaped = true;
      continue;
    }

    if (ch === '"' && (depth > 0 || inString)) {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === "[") {
      if (depth === 0) lastStart = i;
      depth++;
    } else if (ch === "]") {
      depth--;
      if (depth === 0 && lastStart !== -1) {
        lastEnd = i;
      }
    }
  }

  if (lastStart === -1 || lastEnd === -1) return null;
  return raw.slice(lastStart, lastEnd + 1);
}

export function parseFindings(raw: string, vectorName: string): Finding[] {
  const jsonStr = extractJsonArray(raw);
  if (!jsonStr) {
    if (raw.trim().length > 0) {
      console.error(`Warning: [${vectorName}] response did not contain JSON. Analysis may have failed.`);
    }
    return [];
  }

  try {
    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter((f: unknown): f is Finding => {
      if (typeof f !== "object" || f === null) return false;
      const obj = f as Record<string, unknown>;
      return (
        typeof obj.file === "string" &&
        typeof obj.line === "number" &&
        typeof obj.severity === "string" &&
        VALID_SEVERITIES.has(obj.severity) &&
        typeof obj.title === "string" &&
        typeof obj.description === "string" &&
        typeof obj.reproduction === "string"
      );
    });
  } catch {
    console.error(`Warning: [${vectorName}] returned malformed JSON. Analysis may have failed.`);
    return [];
  }
}
