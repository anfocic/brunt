import { describe, test, expect } from "bun:test";
import { consumeStream } from "../src/providers/types.ts";

describe("consumeStream", () => {
  test("concatenates async iterable chunks", async () => {
    async function* gen() {
      yield "Hello";
      yield " ";
      yield "World";
    }
    const result = await consumeStream(gen());
    expect(result).toBe("Hello World");
  });

  test("handles empty stream", async () => {
    async function* gen() {}
    const result = await consumeStream(gen());
    expect(result).toBe("");
  });

  test("handles single chunk", async () => {
    async function* gen() {
      yield "complete response";
    }
    const result = await consumeStream(gen());
    expect(result).toBe("complete response");
  });
});

describe("provider streaming interfaces", () => {
  test("AnthropicProvider has queryStream method", async () => {
    const { AnthropicProvider } = await import("../src/providers/anthropic.ts");
    expect(AnthropicProvider.prototype.queryStream).toBeDefined();
  });

  test("OllamaProvider has queryStream method", async () => {
    const { OllamaProvider } = await import("../src/providers/ollama.ts");
    expect(OllamaProvider.prototype.queryStream).toBeDefined();
  });

  test("ClaudeCliProvider has queryStream method", async () => {
    const { ClaudeCliProvider } = await import("../src/providers/claude-cli.ts");
    expect(ClaudeCliProvider.prototype.queryStream).toBeDefined();
  });
});
