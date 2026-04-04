import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../config.js";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

function withTmpDir(fn: (dir: string) => Promise<void>) {
  return async () => {
    const dir = mkdtempSync(join(tmpdir(), "brunt-config-"));
    const origDir = process.cwd();
    try {
      process.chdir(dir);
      await fn(dir);
    } finally {
      process.chdir(origDir);
      rmSync(dir, { recursive: true });
    }
  };
}

describe("loadConfig", () => {
  test("returns empty config when no file exists", withTmpDir(async () => {
    const config = await loadConfig();
    assert.deepStrictEqual(config, {});
  }));

  test("parses valid yaml with one custom vector", withTmpDir(async (dir) => {
    writeFileSync(join(dir, "brunt.config.yaml"), `
vectors:
  - name: billing
    description: "Checks billing logic"
    prompt: "Look for billing bugs"
`);
    const config = await loadConfig();
    assert.strictEqual(config.vectors?.length, 1);
    assert.strictEqual(config.vectors![0].name, "billing");
    assert.strictEqual(config.vectors![0].description, "Checks billing logic");
    assert.strictEqual(config.vectors![0].prompt, "Look for billing bugs");
  }));

  test("parses valid yaml with multiple vectors", withTmpDir(async (dir) => {
    writeFileSync(join(dir, "brunt.config.yaml"), `
vectors:
  - name: billing
    description: "Billing checks"
    prompt: "Check billing"
  - name: api-compat
    description: "API compat checks"
    prompt: "Check API compat"
`);
    const config = await loadConfig();
    assert.strictEqual(config.vectors?.length, 2);
    assert.strictEqual(config.vectors![0].name, "billing");
    assert.strictEqual(config.vectors![1].name, "api-compat");
  }));

  test("finds brunt.config.yml too", withTmpDir(async (dir) => {
    writeFileSync(join(dir, "brunt.config.yml"), `
vectors:
  - name: perf
    description: "Performance checks"
    prompt: "Check perf"
`);
    const config = await loadConfig();
    assert.strictEqual(config.vectors?.length, 1);
    assert.strictEqual(config.vectors![0].name, "perf");
  }));

  test("explicit path loads that file", withTmpDir(async (dir) => {
    const customPath = join(dir, "custom.yaml");
    writeFileSync(customPath, `
vectors:
  - name: custom
    description: "Custom vector"
    prompt: "Custom prompt"
`);
    const config = await loadConfig(customPath);
    assert.strictEqual(config.vectors?.length, 1);
    assert.strictEqual(config.vectors![0].name, "custom");
  }));

  test("throws on explicit path that does not exist", withTmpDir(async (dir) => {
    await assert.rejects(
      () => loadConfig(join(dir, "nonexistent.yaml")),
      /Config file not found/
    );
  }));

  test("throws when vectors is not an array", withTmpDir(async (dir) => {
    writeFileSync(join(dir, "brunt.config.yaml"), `vectors: "not an array"`);
    await assert.rejects(() => loadConfig(), /"vectors" must be an array/);
  }));

  test("throws when vector missing name", withTmpDir(async (dir) => {
    writeFileSync(join(dir, "brunt.config.yaml"), `
vectors:
  - description: "desc"
    prompt: "prompt"
`);
    await assert.rejects(() => loadConfig(), /"name" must be a non-empty string/);
  }));

  test("throws when vector missing description", withTmpDir(async (dir) => {
    writeFileSync(join(dir, "brunt.config.yaml"), `
vectors:
  - name: test
    prompt: "prompt"
`);
    await assert.rejects(() => loadConfig(), /"description" must be a non-empty string/);
  }));

  test("throws when vector missing prompt", withTmpDir(async (dir) => {
    writeFileSync(join(dir, "brunt.config.yaml"), `
vectors:
  - name: test
    description: "desc"
`);
    await assert.rejects(() => loadConfig(), /"prompt" must be a non-empty string/);
  }));

  test("throws on duplicate vector names", withTmpDir(async (dir) => {
    writeFileSync(join(dir, "brunt.config.yaml"), `
vectors:
  - name: billing
    description: "desc1"
    prompt: "prompt1"
  - name: billing
    description: "desc2"
    prompt: "prompt2"
`);
    await assert.rejects(() => loadConfig(), /Duplicate custom vector name: "billing"/);
  }));

  test("throws on invalid vector name format", withTmpDir(async (dir) => {
    writeFileSync(join(dir, "brunt.config.yaml"), `
vectors:
  - name: "My Vector"
    description: "desc"
    prompt: "prompt"
`);
    await assert.rejects(() => loadConfig(), /must be lowercase alphanumeric/);
  }));

  test("ignores unknown keys gracefully", withTmpDir(async (dir) => {
    writeFileSync(join(dir, "brunt.config.yaml"), `
someOtherKey: true
vectors:
  - name: billing
    description: "desc"
    prompt: "prompt"
    extraField: "ignored"
`);
    const config = await loadConfig();
    assert.strictEqual(config.vectors?.length, 1);
  }));

  test("returns empty config for empty yaml", withTmpDir(async (dir) => {
    writeFileSync(join(dir, "brunt.config.yaml"), "");
    const config = await loadConfig();
    assert.deepStrictEqual(config, {});
  }));
});
