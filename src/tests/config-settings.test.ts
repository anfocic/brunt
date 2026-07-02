import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../config.js";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

function withTmpDir(fn: (dir: string) => Promise<void>) {
  return async () => {
    const dir = mkdtempSync(join(tmpdir(), "brunt-config-settings-"));
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

describe("loadConfig — vector names as strings", () => {
  test("bare string entries become the select list (no crash)", withTmpDir(async (dir) => {
    // This is the shape that previously threw "must be an object".
    writeFileSync(join(dir, "brunt.config.yaml"), `
vectors:
  - correctness
  - security
`);
    const config = await loadConfig();
    assert.deepStrictEqual(config.select, ["correctness", "security"]);
    assert.deepStrictEqual(config.vectors, []);
  }));

  test("mixes built-in names and custom definitions", withTmpDir(async (dir) => {
    writeFileSync(join(dir, "brunt.config.yaml"), `
vectors:
  - correctness
  - name: billing
    description: "Billing checks"
    prompt: "Check billing"
`);
    const config = await loadConfig();
    assert.deepStrictEqual(config.select, ["correctness", "billing"]);
    assert.strictEqual(config.vectors?.length, 1);
    assert.strictEqual(config.vectors![0].name, "billing");
  }));

  test("throws on a duplicate name across string and object", withTmpDir(async (dir) => {
    writeFileSync(join(dir, "brunt.config.yaml"), `
vectors:
  - billing
  - name: billing
    description: "d"
    prompt: "p"
`);
    await assert.rejects(() => loadConfig(), /Duplicate custom vector name: "billing"/);
  }));
});

describe("loadConfig — settings", () => {
  test("parses recognised settings", withTmpDir(async (dir) => {
    writeFileSync(join(dir, "brunt.config.yaml"), `
provider: anthropic
model: claude-x
format: json
failOn: high
fix: true
fixRetries: 3
maxTokens: 8000
`);
    const config = await loadConfig();
    assert.deepStrictEqual(config.settings, {
      provider: "anthropic",
      model: "claude-x",
      format: "json",
      failOn: "high",
      fix: true,
      fixRetries: 3,
      maxTokens: 8000,
    });
  }));

  test("no settings key present → settings undefined", withTmpDir(async (dir) => {
    writeFileSync(join(dir, "brunt.config.yaml"), `
vectors:
  - correctness
`);
    const config = await loadConfig();
    assert.strictEqual(config.settings, undefined);
  }));

  test("throws on an invalid provider", withTmpDir(async (dir) => {
    writeFileSync(join(dir, "brunt.config.yaml"), `provider: not-a-provider`);
    await assert.rejects(() => loadConfig(), /"provider" must be one of/);
  }));

  test("throws on a non-boolean fix", withTmpDir(async (dir) => {
    writeFileSync(join(dir, "brunt.config.yaml"), `fix: "yes"`);
    await assert.rejects(() => loadConfig(), /"fix" must be a boolean/);
  }));

  test("throws on out-of-range fixRetries", withTmpDir(async (dir) => {
    writeFileSync(join(dir, "brunt.config.yaml"), `fixRetries: 99`);
    await assert.rejects(() => loadConfig(), /"fixRetries" must be an integer between 1 and 5/);
  }));
});
