import { describe, test, expect } from "bun:test";
import { scanEngine } from "../src/engine.ts";
import type { DiffFile } from "../src/vectors/types.ts";
import type { Provider } from "../src/providers/types.ts";

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
};

const emptyProvider: Provider = {
  name: "mock-empty",
  async query() {
    return "[]";
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
    const { createVector } = await import("../src/vectors/factory.ts");
    const vector = createVector("test-vec", "test", "Find bugs.");

    const result = await scanEngine({
      files: mockFiles,
      vectors: [vector],
      provider: mockProvider,
      noCache: true,
    });

    expect(result.fromCache).toBe(false);
    expect(result.vectorReports.length).toBe(1);
    expect(result.vectorReports[0]!.name).toBe("test-vec");
  });

  test("returns empty for empty files", async () => {
    const { createVector } = await import("../src/vectors/factory.ts");
    const vector = createVector("test-vec", "test", "Find bugs.");

    const result = await scanEngine({
      files: [],
      vectors: [vector],
      provider: emptyProvider,
      noCache: true,
    });

    expect(result.vectorReports.length).toBe(1);
    expect(result.vectorReports[0]!.findings.length).toBe(0);
  });

  test("calls progress callback", async () => {
    const { createVector } = await import("../src/vectors/factory.ts");
    const vector = createVector("test-vec", "test", "Find bugs.");

    const events: string[] = [];
    await scanEngine(
      { files: mockFiles, vectors: [vector], provider: emptyProvider, noCache: true },
      (event) => events.push(event)
    );

    expect(events).toContain("vectors-start");
    expect(events).toContain("vector-done");
  });
});
