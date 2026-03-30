import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { scanEngine, type ProgressEvent } from "../engine.js";
import type { DiffFile } from "../vectors/types.js";
import type { Provider } from "@packages/llm";

const mockProvider: Provider = {
  name: "mock",
  async query() {
    return JSON.stringify([
      {
        file: "test.ts",
        line: 1,
        severity: "high",
        title: "Test finding",
        description: "A test issue",
        reproduction: "Call test()",
      },
    ]);
  },
  async queryRich(_system, userPrompt) {
    const text = await this.query(userPrompt);
    return { text, usage: { input_tokens: 0, output_tokens: 0 } };
  },
};

const emptyProvider: Provider = {
  name: "mock-empty",
  async query() {
    return "[]";
  },
  async queryRich(_system, userPrompt) {
    const text = await this.query(userPrompt);
    return { text, usage: { input_tokens: 0, output_tokens: 0 } };
  },
};

const mockFiles: DiffFile[] = [
  {
    path: "test.ts",
    language: "typescript",
    hunks: [{ added: ["const x = 1;"], removed: [], context: [] }],
  },
];

describe("scanEngine", () => {
  test("returns results with mock provider", async () => {
    const { createVector } = await import("../vectors/factory.js");
    const vector = createVector("test-vec", "test", "Find bugs.");

    const result = await scanEngine({
      files: mockFiles,
      vectors: [vector],
      provider: mockProvider,
      noCache: true,
    });

    assert.strictEqual(result.fromCache, false);
    assert.strictEqual(result.vectorReports.length, 1);
    assert.strictEqual(result.vectorReports[0]!.name, "test-vec");
  });

  test("returns empty for empty files", async () => {
    const { createVector } = await import("../vectors/factory.js");
    const vector = createVector("test-vec", "test", "Find bugs.");

    const result = await scanEngine({
      files: [],
      vectors: [vector],
      provider: emptyProvider,
      noCache: true,
    });

    assert.strictEqual(result.vectorReports.length, 1);
    assert.strictEqual(result.vectorReports[0]!.findings.length, 0);
  });

  test("calls progress callback", async () => {
    const { createVector } = await import("../vectors/factory.js");
    const vector = createVector("test-vec", "test", "Find bugs.");

    const events: ProgressEvent[] = [];
    await scanEngine(
      { files: mockFiles, vectors: [vector], provider: emptyProvider, noCache: true },
      (event) => events.push(event)
    );

    assert.strictEqual(events.some((e) => e.type === "vectors-start"), true);
    assert.strictEqual(events.some((e) => e.type === "vector-done"), true);
  });
});
