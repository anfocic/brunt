import { stat, readFile } from "node:fs/promises";
import { dirname, join, resolve, relative } from "node:path";
import type { DiffFile } from "./diff.js";

export type PackageGroup = {
  name: string;
  root: string; // relative path to package root (e.g., "packages/api")
  manifest: string; // which manifest file was found
  files: DiffFile[];
};

const MANIFEST_FILES = [
  "package.json",
  "Cargo.toml",
  "go.mod",
  "pyproject.toml",
  "setup.py",
  "Gemfile",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "pubspec.yaml",
];

// Cache directory -> detected root to avoid redundant filesystem calls
const rootCache = new Map<string, { root: string; manifest: string; name: string } | null>();

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function isMonorepoRoot(manifestPath: string): Promise<boolean> {
  if (!manifestPath.endsWith("package.json")) return false;
  try {
    const content = await readFile(manifestPath, "utf-8");
    const parsed = JSON.parse(content);
    return !!(parsed.workspaces);
  } catch {
    return false;
  }
}

export async function resolvePackageName(manifestPath: string, fallbackDir: string): Promise<string> {
  try {
    const content = await readFile(manifestPath, "utf-8");

    if (manifestPath.endsWith("package.json")) {
      const parsed = JSON.parse(content);
      if (parsed.name) return parsed.name;
    } else if (manifestPath.endsWith("Cargo.toml")) {
      const match = content.match(/\[package\]\s*\n(?:.*\n)*?name\s*=\s*"([^"]+)"/);
      if (match?.[1]) return match[1];
    } else if (manifestPath.endsWith("go.mod")) {
      const match = content.match(/^module\s+(\S+)/m);
      if (match?.[1]) return match[1].split("/").pop() ?? match[1];
    } else if (manifestPath.endsWith("pyproject.toml")) {
      const match = content.match(/\[project\]\s*\n(?:.*\n)*?name\s*=\s*"([^"]+)"/);
      if (match?.[1]) return match[1];
    }
  } catch {
    // fall through to directory name
  }

  return fallbackDir.split("/").pop() ?? fallbackDir;
}

async function findGitRoot(): Promise<string> {
  // Walk up from cwd looking for .git
  let dir = process.cwd();
  while (true) {
    if (await fileExists(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return process.cwd(); // reached filesystem root
    dir = parent;
  }
}

export async function detectPackageRoot(
  filePath: string,
  gitRoot: string
): Promise<{ root: string; manifest: string; name: string } | null> {
  const absPath = resolve(filePath);
  let dir = dirname(absPath);
  const absGitRoot = resolve(gitRoot);

  while (true) {
    // Don't walk above git root
    if (!dir.startsWith(absGitRoot) && dir !== absGitRoot) return null;

    if (rootCache.has(dir)) return rootCache.get(dir)!;

    for (const manifest of MANIFEST_FILES) {
      const manifestPath = join(dir, manifest);
      if (await fileExists(manifestPath)) {
        // Skip monorepo root package.json (has "workspaces" field)
        if (await isMonorepoRoot(manifestPath)) {
          // This is the repo root, not a package — stop walking
          rootCache.set(dir, null);
          return null;
        }

        const relRoot = relative(absGitRoot, dir) || ".";
        const name = await resolvePackageName(manifestPath, relRoot);
        const result = { root: relRoot, manifest, name };
        rootCache.set(dir, result);
        return result;
      }
    }

    // At git root and no manifest found
    if (dir === absGitRoot) {
      rootCache.set(dir, null);
      return null;
    }

    dir = dirname(dir);
  }
}

export function clearRootCache(): void {
  rootCache.clear();
}

export async function groupByPackage(files: DiffFile[]): Promise<PackageGroup[]> {
  const gitRoot = await findGitRoot();
  const groups = new Map<string, PackageGroup>();
  const rootGroup: PackageGroup = { name: "<root>", root: ".", manifest: "", files: [] };

  for (const file of files) {
    const detected = await detectPackageRoot(file.path, gitRoot);

    if (!detected) {
      rootGroup.files.push(file);
      continue;
    }

    const key = detected.root;
    if (!groups.has(key)) {
      groups.set(key, {
        name: detected.name,
        root: detected.root,
        manifest: detected.manifest,
        files: [],
      });
    }
    groups.get(key)!.files.push(file);
  }

  const result: PackageGroup[] = [...groups.values()];
  if (rootGroup.files.length > 0) {
    result.push(rootGroup);
  }

  return result;
}

export function filterByScope(
  groups: PackageGroup[],
  scope: string[]
): PackageGroup[] {
  const names = new Set(scope.map((s) => s.trim()));
  const filtered = groups.filter(
    (g) => names.has(g.name) || names.has(g.root)
  );

  if (filtered.length === 0) {
    const available = groups.map((g) => g.name).join(", ");
    throw new Error(
      `No packages match --scope "${scope.join(",")}". Available: ${available}`
    );
  }

  return filtered;
}
