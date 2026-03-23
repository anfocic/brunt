import type { Finding, Severity } from "./types.ts";

const VALID_SEVERITIES: Set<string> = new Set(["low", "medium", "high", "critical"]);

export function parseFindings(raw: string, vectorName: string): Finding[] {
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    if (raw.trim().length > 0) {
      console.error(`Warning: [${vectorName}] response did not contain JSON. Analysis may have failed.`);
    }
    return [];
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
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
