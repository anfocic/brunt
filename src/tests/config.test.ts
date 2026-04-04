import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { loadConfig } from "../config.js";

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), "brunt-config-"));
}

function withDir(fn: (dir: string) => Promise<void>) {
  return async () => {
    const dir = createTempDir();
    const origDir = process.cwd();
    try {
      process.chdir(dir);
      await fn(dir);
    } finally {
      process.chdir(origDir);
    }
  };
}

describe("loadConfig", () => {
  test("returns null when no config file exists", withDir(async () => {
    const result = await loadConfig();
    assert.strictEqual(result, null);
  }));

  test("loads brunt.config.yaml", withDir(async (dir) => {
    writeFileSync(join(dir, "brunt.config.yaml"), `
vectors:
  - name: perf
    description: "Finds performance issues"
    prompt: "You are a performance reviewer. Find performance regressions and inefficiencies."
`);
    const result = await loadConfig();
    assert.ok(result);
    assert.strictEqual(result.vectors!.length, 1);
    assert.strictEqual(result.vectors![0]!.name, "perf");
  }));

  test("loads brunt.config.yml fallback", withDir(async (dir) => {
    writeFileSync(join(dir, "brunt.config.yml"), `
vectors:
  - name: perf
    description: "Finds performance issues"
    prompt: "You are a performance reviewer. Find performance regressions and inefficiencies."
`);
    const result = await loadConfig();
    assert.ok(result);
    assert.strictEqual(result.vectors!.length, 1);
  }));

  test("loads from explicit --config path", withDir(async (dir) => {
    const configPath = join(dir, "custom.yaml");
    writeFileSync(configPath, `
vectors:
  - name: perf
    description: "Finds performance issues"
    prompt: "You are a performance reviewer. Find performance regressions and inefficiencies."
`);
    const result = await loadConfig(configPath);
    assert.ok(result);
    assert.strictEqual(result.vectors!.length, 1);
  }));

  test("throws for missing explicit config path", async () => {
    await assert.rejects(
      () => loadConfig("/nonexistent/brunt.config.yaml"),
      /Config file not found/
    );
  });

  test("throws for invalid YAML", withDir(async (dir) => {
    writeFileSync(join(dir, "brunt.config.yaml"), "vectors:\n  - name: [invalid yaml");
    await assert.rejects(
      () => loadConfig(),
      /Invalid YAML/
    );
  }));

  test("returns empty vectors for config with no vectors key", withDir(async (dir) => {
    writeFileSync(join(dir, "brunt.config.yaml"), "someOtherKey: true\n");
    const result = await loadConfig();
    assert.ok(result);
    assert.deepStrictEqual(result.vectors, []);
  }));

  test("parses all optional fields", withDir(async (dir) => {
    writeFileSync(join(dir, "brunt.config.yaml"), `
vectors:
  - name: api-compat
    description: "Detects breaking API changes"
    prompt: "You are reviewing changes for backwards compatibility. Find breaking changes."
    severity: high
    include:
      - "*.ts"
      - "*.js"
    exclude:
      - "*.test.ts"
`);
    const result = await loadConfig();
    assert.ok(result);
    const v = result.vectors![0]!;
    assert.strictEqual(v.name, "api-compat");
    assert.strictEqual(v.severity, "high");
    assert.deepStrictEqual(v.include, ["*.ts", "*.js"]);
    assert.deepStrictEqual(v.exclude, ["*.test.ts"]);
  }));
});

describe("config validation", () => {
  test("rejects missing name", withDir(async (dir) => {
    writeFileSync(join(dir, "brunt.config.yaml"), `
vectors:
  - description: "test"
    prompt: "You are a reviewer that checks for test quality issues in code."
`);
    await assert.rejects(() => loadConfig(), /"name" is required/);
  }));

  test("rejects missing prompt", withDir(async (dir) => {
    writeFileSync(join(dir, "brunt.config.yaml"), `
vectors:
  - name: test
    description: "test"
`);
    await assert.rejects(() => loadConfig(), /"prompt" is required/);
  }));

  test("rejects short prompt", withDir(async (dir) => {
    writeFileSync(join(dir, "brunt.config.yaml"), `
vectors:
  - name: test
    description: "test"
    prompt: "too short"
`);
    await assert.rejects(() => loadConfig(), /at least 20 characters/);
  }));

  test("rejects name with spaces", withDir(async (dir) => {
    writeFileSync(join(dir, "brunt.config.yaml"), `
vectors:
  - name: "my vector"
    description: "test"
    prompt: "You are a reviewer that checks for test quality issues in code."
`);
    await assert.rejects(() => loadConfig(), /must not contain spaces/);
  }));

  test("rejects builtin vector name collision", withDir(async (dir) => {
    writeFileSync(join(dir, "brunt.config.yaml"), `
vectors:
  - name: correctness
    description: "test"
    prompt: "You are a reviewer that checks for test quality issues in code."
`);
    await assert.rejects(() => loadConfig(), /conflicts with a built-in vector/);
  }));

  test("rejects duplicate custom vector names", withDir(async (dir) => {
    writeFileSync(join(dir, "brunt.config.yaml"), `
vectors:
  - name: perf
    description: "test"
    prompt: "You are a reviewer that checks for performance issues in code."
  - name: perf
    description: "test2"
    prompt: "You are a reviewer that checks for performance issues in code."
`);
    await assert.rejects(() => loadConfig(), /duplicate vector name/);
  }));

  test("rejects invalid severity", withDir(async (dir) => {
    writeFileSync(join(dir, "brunt.config.yaml"), `
vectors:
  - name: perf
    description: "test"
    prompt: "You are a reviewer that checks for performance issues in code."
    severity: extreme
`);
    await assert.rejects(() => loadConfig(), /"severity" must be one of/);
  }));

  test("rejects non-array include", withDir(async (dir) => {
    writeFileSync(join(dir, "brunt.config.yaml"), `
vectors:
  - name: perf
    description: "test"
    prompt: "You are a reviewer that checks for performance issues in code."
    include: "*.ts"
`);
    await assert.rejects(() => loadConfig(), /"include" must be an array/);
  }));
});
