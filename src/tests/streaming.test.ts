import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { consumeStream } from "@packages/llm";

describe("consumeStream", () => {
  test("concatenates async iterable chunks", async () => {
    async function* gen() {
      yield "Hello";
      yield " ";
      yield "World";
    }
    const result = await consumeStream(gen());
    assert.strictEqual(result, "Hello World");
  });

  test("handles empty stream", async () => {
    async function* gen() {}
    const result = await consumeStream(gen());
    assert.strictEqual(result, "");
  });

  test("handles single chunk", async () => {
    async function* gen() {
      yield "complete response";
    }
    const result = await consumeStream(gen());
    assert.strictEqual(result, "complete response");
  });
});

describe("provider streaming interfaces", () => {
  test("AnthropicProvider has queryStream method", async () => {
    const { AnthropicProvider } = await import("@packages/llm");
    assert.notStrictEqual(AnthropicProvider.prototype.queryStream, undefined);
  });

  test("OllamaProvider has queryStream method", async () => {
    const { OllamaProvider } = await import("@packages/llm");
    assert.notStrictEqual(OllamaProvider.prototype.queryStream, undefined);
  });

  test("ClaudeCliProvider has queryStream method", async () => {
    const { ClaudeCliProvider } = await import("@packages/llm");
    assert.notStrictEqual(ClaudeCliProvider.prototype.queryStream, undefined);
  });
});
