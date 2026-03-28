import { describe, test, expect } from "bun:test";
import { parseYaml, loadConfig } from "../src/config.ts";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { spawnSync } from "child_process";
import { join } from "path";
import { tmpdir } from "os";

describe("parseYaml", () => {
  test("parses key-value pairs", () => {
    const result = parseYaml("provider: ollama\nmodel: llama3\n");
    expect(result.provider).toBe("ollama");
    expect(result.model).toBe("llama3");
  });

  test("keeps numbers as strings (mapToConfig handles conversion)", () => {
    const result = parseYaml("maxTokens: 4096\nconcurrency: 3\n");
    expect(result.maxTokens).toBe("4096");
    expect(result.concurrency).toBe("3");
  });

  test("parses booleans", () => {
    const result = parseYaml("noTests: true\nenabled: false\n");
    expect(result.noTests).toBe(true);
    expect(result.enabled).toBe(false);
  });

  test("parses inline arrays", () => {
    const result = parseYaml("vectors: [correctness, security, performance]\n");
    expect(result.vectors).toEqual(["correctness", "security", "performance"]);
  });

  test("parses indented arrays", () => {
    const result = parseYaml("vectors:\n  - correctness\n  - security\n");
    expect(result.vectors).toEqual(["correctness", "security"]);
  });

  test("parses nested objects", () => {
    const result = parseYaml("sensitive:\n  enabled: true\n  threshold: 5\n");
    expect(result.sensitive).toEqual({ enabled: true, threshold: "5" });
  });

  test("ignores comments", () => {
    const result = parseYaml("# This is a comment\nprovider: ollama # inline comment\n");
    expect(result.provider).toBe("ollama");
  });

  test("ignores blank lines", () => {
    const result = parseYaml("\n\nprovider: ollama\n\nmodel: llama3\n\n");
    expect(result.provider).toBe("ollama");
    expect(result.model).toBe("llama3");
  });

  test("handles quoted strings", () => {
    const result = parseYaml('model: "claude-sonnet-4-6-20250514"\n');
    expect(result.model).toBe("claude-sonnet-4-6-20250514");
  });

  test("handles empty value as nested object start", () => {
    const result = parseYaml("sensitive:\n  enabled: false\n");
    expect(result.sensitive).toEqual({ enabled: false });
  });
});

describe("loadConfig", () => {
  function createTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "brunt-config-"));
    spawnSync("git", ["init"], { cwd: dir });
    return dir;
  }

  test("returns empty config when no file exists", async () => {
    const dir = createTempDir();
    try {
      const config = await loadConfig(dir);
      expect(config).toEqual({});
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  test("loads config from directory", async () => {
    const dir = createTempDir();
    writeFileSync(
      join(dir, "brunt.config.yaml"),
      "provider: ollama\nmodel: llama3\nmaxTokens: 2048\n"
    );
    const origDir = process.cwd();
    try {
      process.chdir(dir);
      const config = await loadConfig(dir);
      expect(config.provider).toBe("ollama");
      expect(config.model).toBe("llama3");
      expect(config.maxTokens).toBe(2048);
    } finally {
      process.chdir(origDir);
      rmSync(dir, { recursive: true });
    }
  });

  test("loads vectors as array", async () => {
    const dir = createTempDir();
    writeFileSync(
      join(dir, "brunt.config.yaml"),
      "vectors:\n  - correctness\n  - security\n"
    );
    const origDir = process.cwd();
    try {
      process.chdir(dir);
      const config = await loadConfig(dir);
      expect(config.vectors).toEqual(["correctness", "security"]);
    } finally {
      process.chdir(origDir);
      rmSync(dir, { recursive: true });
    }
  });

  test("loads sensitive config", async () => {
    const dir = createTempDir();
    writeFileSync(
      join(dir, "brunt.config.yaml"),
      "sensitive:\n  enabled: false\n"
    );
    const origDir = process.cwd();
    try {
      process.chdir(dir);
      const config = await loadConfig(dir);
      expect(config.sensitive?.enabled).toBe(false);
    } finally {
      process.chdir(origDir);
      rmSync(dir, { recursive: true });
    }
  });
});
