import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { filterByScope, detectScope } from "../scope.js";
import type { DiffFile } from "../diff.js";

function makeDiffFile(path: string): DiffFile {
  return { path, hunks: [], language: "typescript" };
}

describe("filterByScope", () => {
  const files = [
    makeDiffFile("packages/auth/src/login.ts"),
    makeDiffFile("packages/auth/src/logout.ts"),
    makeDiffFile("packages/billing/src/charge.ts"),
    makeDiffFile("apps/web/index.ts"),
    makeDiffFile("README.md"),
  ];

  test("filters files by path prefix", () => {
    const result = filterByScope(files, "packages/auth");
    assert.strictEqual(result.length, 2);
    assert.ok(result.every((f) => f.path.startsWith("packages/auth/")));
  });

  test("returns empty when no files match scope", () => {
    const result = filterByScope(files, "packages/unknown");
    assert.strictEqual(result.length, 0);
  });

  test("scope '.' returns all files", () => {
    const result = filterByScope(files, ".");
    assert.strictEqual(result.length, files.length);
  });

  test("handles trailing slash in scope", () => {
    const result = filterByScope(files, "packages/auth/");
    assert.strictEqual(result.length, 2);
  });

  test("does not match partial prefixes", () => {
    const result = filterByScope(files, "packages/au");
    assert.strictEqual(result.length, 0);
  });
});

describe("detectScope", () => {
  test("detects single package scope", () => {
    const files = [
      makeDiffFile("packages/auth/src/login.ts"),
      makeDiffFile("packages/auth/src/logout.ts"),
      makeDiffFile("packages/auth/test/login.test.ts"),
    ];
    assert.strictEqual(detectScope(files), "packages/auth");
  });

  test("returns null for cross-package changes", () => {
    const files = [
      makeDiffFile("packages/auth/src/login.ts"),
      makeDiffFile("packages/billing/src/charge.ts"),
    ];
    assert.strictEqual(detectScope(files), null);
  });

  test("returns null when files are at repo root", () => {
    const files = [
      makeDiffFile("README.md"),
      makeDiffFile("package.json"),
    ];
    assert.strictEqual(detectScope(files), null);
  });

  test("returns null for mixed root and package files", () => {
    const files = [
      makeDiffFile("packages/auth/src/login.ts"),
      makeDiffFile("README.md"),
    ];
    assert.strictEqual(detectScope(files), null);
  });

  test("returns null for empty file list", () => {
    assert.strictEqual(detectScope([]), null);
  });

  test("detects apps/ prefix", () => {
    const files = [
      makeDiffFile("apps/web/src/index.ts"),
      makeDiffFile("apps/web/src/app.ts"),
    ];
    assert.strictEqual(detectScope(files), "apps/web");
  });

  test("detects services/ prefix", () => {
    const files = [
      makeDiffFile("services/api/handler.ts"),
      makeDiffFile("services/api/routes.ts"),
    ];
    assert.strictEqual(detectScope(files), "services/api");
  });

  test("detects libs/ prefix", () => {
    const files = [
      makeDiffFile("libs/shared/utils.ts"),
    ];
    assert.strictEqual(detectScope(files), "libs/shared");
  });

  test("detects modules/ prefix", () => {
    const files = [
      makeDiffFile("modules/core/index.ts"),
    ];
    assert.strictEqual(detectScope(files), "modules/core");
  });

  test("returns null for non-standard monorepo directories", () => {
    const files = [
      makeDiffFile("components/header/index.ts"),
      makeDiffFile("components/header/style.css"),
    ];
    assert.strictEqual(detectScope(files), null);
  });
});
