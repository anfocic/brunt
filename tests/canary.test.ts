import { describe, test, expect } from "bun:test";
import { injectCanary, verifyCanary, verifyCanaryWithLlm } from "../src/canary.ts";
import type { DiffFile } from "../src/diff.ts";
import type { Finding } from "../src/vectors/types.ts";
import type { Provider } from "../src/providers/types.ts";

const makeDiffFile = (path: string, language: string): DiffFile => ({
  path,
  language,
  hunks: [{ added: ["const x = 1;"], removed: [], context: [] }],
});

describe("injectCanary", () => {
  test("adds a canary file to the diff", () => {
    const files = [makeDiffFile("src/app.ts", "typescript")];
    const { files: result, canary } = injectCanary(files);

    expect(result.length).toBe(2);
    expect(canary.file).toContain("canary");
    expect(canary.keyword.length).toBeGreaterThan(0);
  });

  test("canary file contains the keyword in its hunks", () => {
    const files = [makeDiffFile("src/app.ts", "typescript")];
    const { files: result, canary } = injectCanary(files);

    const canaryFile = result.find((f) => f.path === canary.file);
    expect(canaryFile).toBeDefined();
    const code = canaryFile!.hunks[0].added.join("\n");
    expect(code).toContain(canary.keyword);
  });

  test("generates unique canaries each call", () => {
    const files = [makeDiffFile("src/app.ts", "typescript")];
    const a = injectCanary(files);
    const b = injectCanary(files);
    expect(a.canary.keyword).not.toBe(b.canary.keyword);
  });

  test("works with empty file list", () => {
    const { files, canary } = injectCanary([]);
    expect(files.length).toBe(1);
    expect(canary.file).toContain("canary");
  });
});

describe("verifyCanary", () => {
  test("returns true when canary file is found in findings", () => {
    const canary = { file: "src/app.canary.ts", line: 1, keyword: "__check_abc123" };
    const findings: Finding[] = [
      { file: "src/app.canary.ts", line: 1, severity: "critical", title: "eval usage", description: "Uses eval", reproduction: "call it" },
    ];
    expect(verifyCanary(findings, canary)).toBe(true);
  });

  test("returns true when keyword appears in title", () => {
    const canary = { file: "src/app.canary.ts", line: 1, keyword: "__check_abc123" };
    const findings: Finding[] = [
      { file: "other.ts", line: 5, severity: "high", title: "__check_abc123 uses eval", description: "Bad", reproduction: "x" },
    ];
    expect(verifyCanary(findings, canary)).toBe(true);
  });

  test("returns false when canary is missing", () => {
    const canary = { file: "src/app.canary.ts", line: 1, keyword: "__check_abc123" };
    const findings: Finding[] = [
      { file: "src/real.ts", line: 10, severity: "medium", title: "Some other bug", description: "Desc", reproduction: "x" },
    ];
    expect(verifyCanary(findings, canary)).toBe(false);
  });

  test("returns false for empty findings", () => {
    const canary = { file: "src/app.canary.ts", line: 1, keyword: "__check_abc123" };
    expect(verifyCanary([], canary)).toBe(false);
  });
});

describe("verifyCanaryWithLlm", () => {
  const canary = { file: "src/app.canary.ts", line: 1, keyword: "__check_abc123" };

  function mockProvider(response: string): Provider {
    return {
      name: "mock",
      query: async () => response,
    };
  }

  test("returns true when LLM says yes", async () => {
    const findings: Finding[] = [
      { file: "src/app.canary.ts", line: 1, severity: "critical", title: "eval usage", description: "Uses eval", reproduction: "call it" },
    ];
    const result = await verifyCanaryWithLlm(canary, findings, mockProvider("yes"));
    expect(result).toBe(true);
  });

  test("returns true for verbose yes response", async () => {
    const result = await verifyCanaryWithLlm(canary, [], mockProvider("Yes, the canary was detected."));
    expect(result).toBe(true);
  });

  test("returns false when LLM says no", async () => {
    const result = await verifyCanaryWithLlm(canary, [], mockProvider("no"));
    expect(result).toBe(false);
  });

  test("returns false for unexpected response", async () => {
    const result = await verifyCanaryWithLlm(canary, [], mockProvider("I'm not sure"));
    expect(result).toBe(false);
  });
});
