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
