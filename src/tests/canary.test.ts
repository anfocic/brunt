import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { injectCanary, verifyCanary, verifyCanaryWithLlm } from "../canary.js";
import type { DiffFile } from "../diff.js";
import type { Finding } from "../vectors/types.js";
import type { Provider } from "@packages/llm";

const makeDiffFile = (path: string, language: string): DiffFile => ({
  path,
  language,
  hunks: [{ added: ["const x = 1;"], removed: [], context: [] }],
});

describe("injectCanary", () => {
  test("adds a canary file to the diff", () => {
    const files = [makeDiffFile("src/app.ts", "typescript")];
    const { files: result, canary } = injectCanary(files);

    assert.strictEqual(result.length, 2);
    assert.ok(canary.file.includes("canary"));
    assert.ok(canary.keyword.length > 0);
  });

  test("canary file contains the keyword in its hunks", () => {
    const files = [makeDiffFile("src/app.ts", "typescript")];
    const { files: result, canary } = injectCanary(files);

    const canaryFile = result.find((f) => f.path === canary.file);
    assert.notStrictEqual(canaryFile, undefined);
    const code = canaryFile!.hunks[0].added.join("\n");
    assert.ok(code.includes(canary.keyword));
  });

  test("generates unique canaries each call", () => {
    const files = [makeDiffFile("src/app.ts", "typescript")];
    const a = injectCanary(files);
    const b = injectCanary(files);
    assert.notStrictEqual(a.canary.keyword, b.canary.keyword);
  });

  test("works with empty file list", () => {
    const { files, canary } = injectCanary([]);
    assert.strictEqual(files.length, 1);
    assert.ok(canary.file.includes("canary"));
  });
});

describe("verifyCanary", () => {
  test("returns true when canary file is found in findings", () => {
    const canary = { file: "src/app.canary.ts", line: 1, keyword: "__check_abc123" };
    const findings: Finding[] = [
      { file: "src/app.canary.ts", line: 1, severity: "critical", title: "eval usage", description: "Uses eval", reproduction: "call it" },
    ];
    assert.strictEqual(verifyCanary(findings, canary), true);
  });

  test("returns true when keyword appears in title", () => {
    const canary = { file: "src/app.canary.ts", line: 1, keyword: "__check_abc123" };
    const findings: Finding[] = [
      { file: "other.ts", line: 5, severity: "high", title: "__check_abc123 uses eval", description: "Bad", reproduction: "x" },
    ];
    assert.strictEqual(verifyCanary(findings, canary), true);
  });

  test("returns false when canary is missing", () => {
    const canary = { file: "src/app.canary.ts", line: 1, keyword: "__check_abc123" };
    const findings: Finding[] = [
      { file: "src/real.ts", line: 10, severity: "medium", title: "Some other bug", description: "Desc", reproduction: "x" },
    ];
    assert.strictEqual(verifyCanary(findings, canary), false);
  });

  test("returns false for empty findings", () => {
    const canary = { file: "src/app.canary.ts", line: 1, keyword: "__check_abc123" };
    assert.strictEqual(verifyCanary([], canary), false);
  });
});

describe("verifyCanaryWithLlm", () => {
  const canary = { file: "src/app.canary.ts", line: 1, keyword: "__check_abc123" };

  function mockProvider(response: string): Provider {
    return {
      name: "mock",
      query: async () => response,
      queryRich: async () => ({ text: response, usage: { input_tokens: 0, output_tokens: 0 } }),
    };
  }

  test("returns true when LLM says yes", async () => {
    const findings: Finding[] = [
      { file: "src/app.canary.ts", line: 1, severity: "critical", title: "eval usage", description: "Uses eval", reproduction: "call it" },
    ];
    const result = await verifyCanaryWithLlm(canary, findings, mockProvider("yes"));
    assert.strictEqual(result, true);
  });

  test("returns true for verbose yes response with structural match", async () => {
    const findings: Finding[] = [
      { file: "src/app.canary.ts", line: 1, severity: "critical", title: "eval usage", description: "Uses eval", reproduction: "call it" },
    ];
    const result = await verifyCanaryWithLlm(canary, findings, mockProvider("Yes, the canary was detected."));
    assert.strictEqual(result, true);
  });

  test("returns false when no structural match even if LLM says yes", async () => {
    const result = await verifyCanaryWithLlm(canary, [], mockProvider("yes"));
    assert.strictEqual(result, false);
  });

  test("returns false when LLM says no despite structural match", async () => {
    const findings: Finding[] = [
      { file: "src/app.canary.ts", line: 1, severity: "critical", title: "eval usage", description: "Uses eval", reproduction: "call it" },
    ];
    const result = await verifyCanaryWithLlm(canary, findings, mockProvider("no"));
    assert.strictEqual(result, false);
  });

  test("returns false for unexpected response", async () => {
    const findings: Finding[] = [
      { file: "src/app.canary.ts", line: 1, severity: "critical", title: "eval usage", description: "Uses eval", reproduction: "call it" },
    ];
    const result = await verifyCanaryWithLlm(canary, findings, mockProvider("I'm not sure"));
    assert.strictEqual(result, false);
  });
});
