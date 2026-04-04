import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { groupByPackage, filterByScope, detectPackageRoot, resolvePackageName, clearRootCache, type PackageGroup } from "../monorepo.js";
import type { DiffFile } from "../diff.js";

function makeDiffFile(path: string): DiffFile {
  return {
    path,
    language: path.split(".").pop() ?? "",
    hunks: [{ added: ["const x = 1;"], removed: [], context: [] }],
  };
}

function createTempMonorepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "brunt-mono-"));

  // Root package.json with workspaces (monorepo root, not a package)
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "monorepo-root", workspaces: ["packages/*"] })
  );

  // packages/api with its own package.json
  mkdirSync(join(dir, "packages", "api", "src"), { recursive: true });
  writeFileSync(
    join(dir, "packages", "api", "package.json"),
    JSON.stringify({ name: "@myapp/api" })
  );
  writeFileSync(join(dir, "packages", "api", "src", "index.ts"), "export const api = true;\n");

  // packages/web with its own package.json
  mkdirSync(join(dir, "packages", "web", "src"), { recursive: true });
  writeFileSync(
    join(dir, "packages", "web", "package.json"),
    JSON.stringify({ name: "@myapp/web" })
  );
  writeFileSync(join(dir, "packages", "web", "src", "app.tsx"), "export const App = () => null;\n");

  // A root-level config file (no package boundary)
  writeFileSync(join(dir, "tsconfig.json"), "{}");

  // Initialize .git so findGitRoot works
  mkdirSync(join(dir, ".git"));

  return dir;
}

describe("monorepo", () => {
  let dir: string;
  let origDir: string;

  beforeEach(() => {
    clearRootCache();
    dir = createTempMonorepo();
    origDir = process.cwd();
    process.chdir(dir);
  });

  // Cleanup handled by OS temp directory

  describe("detectPackageRoot", () => {
    test("finds package.json for nested file", async () => {
      const result = await detectPackageRoot(
        join(dir, "packages", "api", "src", "index.ts"),
        dir
      );
      assert.ok(result);
      assert.strictEqual(result.name, "@myapp/api");
      assert.strictEqual(result.manifest, "package.json");
      assert.strictEqual(result.root, "packages/api");
    });

    test("returns null for root-level files (monorepo root has workspaces)", async () => {
      const result = await detectPackageRoot(
        join(dir, "tsconfig.json"),
        dir
      );
      assert.strictEqual(result, null);
    });

    test("skips monorepo root package.json with workspaces field", async () => {
      // A file directly under the monorepo root should not match the root package.json
      mkdirSync(join(dir, "scripts"), { recursive: true });
      writeFileSync(join(dir, "scripts", "build.ts"), "console.log('build');");
      const result = await detectPackageRoot(
        join(dir, "scripts", "build.ts"),
        dir
      );
      assert.strictEqual(result, null);
    });
  });

  describe("resolvePackageName", () => {
    test("reads name from package.json", () => {
      const content = JSON.stringify({ name: "@myapp/api" });
      const name = resolvePackageName("package.json", content, "packages/api");
      assert.strictEqual(name, "@myapp/api");
    });

    test("falls back to directory name for missing name field", () => {
      const content = JSON.stringify({ version: "1.0.0" });
      const name = resolvePackageName("package.json", content, "packages/api");
      assert.strictEqual(name, "api");
    });

    test("falls back to directory name for invalid JSON", () => {
      const name = resolvePackageName("package.json", "not json", "packages/api");
      assert.strictEqual(name, "api");
    });
  });

  describe("groupByPackage", () => {
    test("groups files by their package boundary", async () => {
      const files = [
        makeDiffFile("packages/api/src/index.ts"),
        makeDiffFile("packages/api/src/routes.ts"),
        makeDiffFile("packages/web/src/app.tsx"),
      ];

      const groups = await groupByPackage(files);

      // Should have 2 groups: api and web
      assert.strictEqual(groups.length, 2);

      const api = groups.find((g) => g.name === "@myapp/api");
      const web = groups.find((g) => g.name === "@myapp/web");

      assert.ok(api);
      assert.strictEqual(api.files.length, 2);
      assert.strictEqual(api.root, "packages/api");

      assert.ok(web);
      assert.strictEqual(web.files.length, 1);
    });

    test("puts root-level files in <root> group", async () => {
      const files = [
        makeDiffFile("packages/api/src/index.ts"),
        makeDiffFile("tsconfig.json"),
      ];

      const groups = await groupByPackage(files);

      const rootGroup = groups.find((g) => g.name === "<root>");
      assert.ok(rootGroup);
      assert.strictEqual(rootGroup.files.length, 1);
      assert.strictEqual(rootGroup.files[0]!.path, "tsconfig.json");
    });

    test("returns single group for non-monorepo project", async () => {
      // Remove workspaces field so root package.json is treated as a package
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({ name: "simple-app" })
      );
      clearRootCache();

      const files = [makeDiffFile("src/index.ts")];

      // Create the file so detection works
      mkdirSync(join(dir, "src"), { recursive: true });
      writeFileSync(join(dir, "src", "index.ts"), "");

      const groups = await groupByPackage(files);

      // Should detect the root package.json as the package
      assert.strictEqual(groups.length, 1);
      assert.strictEqual(groups[0]!.name, "simple-app");
    });
  });

  describe("filterByScope", () => {
    test("filters by package name", () => {
      const groups: PackageGroup[] = [
        { name: "@myapp/api", root: "packages/api", manifest: "package.json", files: [makeDiffFile("packages/api/src/index.ts")] },
        { name: "@myapp/web", root: "packages/web", manifest: "package.json", files: [makeDiffFile("packages/web/src/app.tsx")] },
      ];

      const filtered = filterByScope(groups, ["@myapp/api"]);
      assert.strictEqual(filtered.length, 1);
      assert.strictEqual(filtered[0]!.name, "@myapp/api");
    });

    test("filters by package root path", () => {
      const groups: PackageGroup[] = [
        { name: "@myapp/api", root: "packages/api", manifest: "package.json", files: [makeDiffFile("packages/api/src/index.ts")] },
        { name: "@myapp/web", root: "packages/web", manifest: "package.json", files: [makeDiffFile("packages/web/src/app.tsx")] },
      ];

      const filtered = filterByScope(groups, ["packages/web"]);
      assert.strictEqual(filtered.length, 1);
      assert.strictEqual(filtered[0]!.name, "@myapp/web");
    });

    test("supports multiple scope values", () => {
      const groups: PackageGroup[] = [
        { name: "@myapp/api", root: "packages/api", manifest: "package.json", files: [] },
        { name: "@myapp/web", root: "packages/web", manifest: "package.json", files: [] },
        { name: "@myapp/shared", root: "packages/shared", manifest: "package.json", files: [] },
      ];

      const filtered = filterByScope(groups, ["@myapp/api", "@myapp/shared"]);
      assert.strictEqual(filtered.length, 2);
    });

    test("throws when no packages match", () => {
      const groups: PackageGroup[] = [
        { name: "@myapp/api", root: "packages/api", manifest: "package.json", files: [] },
      ];

      assert.throws(
        () => filterByScope(groups, ["nonexistent"]),
        /No packages match/
      );
    });
  });
});
