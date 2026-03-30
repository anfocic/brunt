export function extractJsonPath(obj: unknown, path: string): string | undefined {
  let current: unknown = obj;
  for (const part of path.split(".")) {
    if (current === null || current === undefined || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  if (current === undefined || current === null) return undefined;
  return typeof current === "string" ? current : String(current);
}

export function formatError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function shortSha(sha: string | null): string {
  return sha ? sha.slice(0, 8) : "-";
}

export function formatSeconds(ms: number, decimals = 1): string {
  return (ms / 1000).toFixed(decimals);
}
