import { describe, test, expect } from "bun:test";
import { parseArgs, mergeArgs } from "../src/cli.ts";
import type { BruntConfig } from "../src/config.ts";

describe("parseArgs", () => {
  test("returns undefined for unset flags", () => {
    const result = parseArgs(["node", "cli", "scan"]);
    expect(result.command).toBe("scan");
    expect(result.diff).toBeUndefined();
    expect(result.provider).toBeUndefined();
    expect(result.format).toBeUndefined();
    expect(result.failOn).toBeUndefined();
    expect(result.noTests).toBeUndefined();
    expect(result.maxTokens).toBeUndefined();
    expect(result.model).toBeUndefined();
  });

  test("parses all flags", () => {
    const result = parseArgs([
      "node", "cli", "scan",
      "--diff", "main..HEAD",
      "--provider", "anthropic",
      "--format", "json",
      "--fail-on", "high",
      "--vectors", "correctness,security",
      "--no-tests",
      "--max-tokens", "2048",
      "--model", "llama3",
    ]);
    expect(result.diff).toBe("main..HEAD");
    expect(result.provider).toBe("anthropic");
    expect(result.format).toBe("json");
    expect(result.failOn).toBe("high");
    expect(result.vectors).toEqual(["correctness", "security"]);
    expect(result.noTests).toBe(true);
    expect(result.maxTokens).toBe(2048);
    expect(result.model).toBe("llama3");
  });

  test("parses --fix flag", () => {
    const result = parseArgs(["node", "cli", "scan", "--fix"]);
    expect(result.fix).toBe(true);
  });

  test("parses --fix-retries flag", () => {
    const result = parseArgs(["node", "cli", "scan", "--fix-retries", "3"]);
    expect(result.fixRetries).toBe(3);
  });

  test("rejects invalid --fix-retries", () => {
    expect(() => parseArgs(["node", "cli", "scan", "--fix-retries", "0"])).toThrow();
    expect(() => parseArgs(["node", "cli", "scan", "--fix-retries", "6"])).toThrow();
    expect(() => parseArgs(["node", "cli", "scan", "--fix-retries", "abc"])).toThrow();
  });
});

describe("mergeArgs", () => {
  test("applies defaults when no config and no CLI flags", () => {
    const partial = parseArgs(["node", "cli", "scan"]);
    const config: BruntConfig = {};
    const args = mergeArgs(partial, config);

    expect(args.diff).toBe("HEAD~1");
    expect(args.provider).toBe("claude-cli");
    expect(args.format).toBe("text");
    expect(args.failOn).toBe("medium");
    expect(args.noTests).toBe(false);
  });

  test("config overrides defaults", () => {
    const partial = parseArgs(["node", "cli", "scan"]);
    const config: BruntConfig = {
      provider: "ollama",
      model: "llama3",
      format: "json",
      diff: "main..HEAD",
      maxTokens: 2048,
      concurrency: 5,
    };
    const args = mergeArgs(partial, config);

    expect(args.provider).toBe("ollama");
    expect(args.model).toBe("llama3");
    expect(args.format).toBe("json");
    expect(args.diff).toBe("main..HEAD");
    expect(args.maxTokens).toBe(2048);
    expect(args.concurrency).toBe(5);
  });

  test("CLI flags override config", () => {
    const partial = parseArgs([
      "node", "cli", "scan",
      "--provider", "anthropic",
      "--format", "sarif",
    ]);
    const config: BruntConfig = {
      provider: "ollama",
      format: "json",
    };
    const args = mergeArgs(partial, config);

    expect(args.provider).toBe("anthropic");
    expect(args.format).toBe("sarif");
  });

  test("fix defaults to false", () => {
    const partial = parseArgs(["node", "cli", "scan"]);
    const args = mergeArgs(partial, {});
    expect(args.fix).toBe(false);
    expect(args.fixRetries).toBe(2);
  });

  test("fix config is passed through", () => {
    const partial = parseArgs(["node", "cli", "scan"]);
    const config: BruntConfig = { fix: true, fixRetries: 3 };
    const args = mergeArgs(partial, config);
    expect(args.fix).toBe(true);
    expect(args.fixRetries).toBe(3);
  });

  test("CLI --fix overrides config", () => {
    const partial = parseArgs(["node", "cli", "scan", "--fix"]);
    const config: BruntConfig = { fix: false };
    const args = mergeArgs(partial, config);
    expect(args.fix).toBe(true);
  });

  test("sensitive config is passed through", () => {
    const partial = parseArgs(["node", "cli", "scan"]);
    const config: BruntConfig = {
      sensitive: {
        enabled: false,
        patterns: ["*.secret"],
      },
    };
    const args = mergeArgs(partial, config);

    expect(args.sensitiveEnabled).toBe(false);
    expect(args.sensitivePatterns).toEqual(["*.secret"]);
  });
});
