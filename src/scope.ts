import type { DiffFile } from "./diff.js";

const MONOREPO_PREFIXES = ["packages/", "apps/", "services/", "libs/", "modules/"];

/**
 * Filter diff files to only those under the given scope path.
 * Scope "." means scan everything (no filtering).
 */
export function filterByScope(files: DiffFile[], scope: string): DiffFile[] {
  if (scope === ".") return files;

  const normalized = scope.replace(/\/+$/, "");
  return files.filter(
    (f) => f.path.startsWith(normalized + "/") || f.path === normalized
  );
}

/**
 * Auto-detect if all changed files belong to a single monorepo package.
 * Returns the package prefix (e.g. "packages/auth") or null.
 */
export function detectScope(files: DiffFile[]): string | null {
  if (files.length === 0) return null;

  const packagePrefixes = new Set<string>();

  for (const file of files) {
    const isMonorepo = MONOREPO_PREFIXES.some((p) => file.path.startsWith(p));
    if (!isMonorepo) return null; // file at root or non-standard dir — scan all

    const parts = file.path.split("/");
    if (parts.length < 2) return null;
    packagePrefixes.add(parts[0] + "/" + parts[1]);
  }

  if (packagePrefixes.size === 1) {
    return [...packagePrefixes][0]!;
  }

  // Files span multiple packages — scan all together
  return null;
}
