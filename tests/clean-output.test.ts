import { describe, test, expect } from "bun:test";
import { cleanLlmOutput } from "../src/proof/test-gen.ts";

describe("cleanLlmOutput", () => {
  test("returns clean code as-is", () => {
    const code = 'import { foo } from "./bar";\n\ntest("works", () => {\n  expect(foo()).toBe(1);\n});\n';
    expect(cleanLlmOutput(code)).toBe(code);
  });

  test("strips markdown fences", () => {
    const raw = '```typescript\nimport { x } from "./y";\ntest("a", () => {});\n```';
    const result = cleanLlmOutput(raw);
    expect(result).not.toContain("```");
    expect(result).toContain('import { x }');
  });

  test("removes preamble chatter", () => {
    const raw = 'Here is the test file:\n\nimport { foo } from "./bar";\ntest("x", () => {\n  expect(1).toBe(2);\n});';
    const result = cleanLlmOutput(raw);
    expect(result).not.toContain("Here is");
    expect(result).toContain("import { foo }");
  });

  test("removes trailing chatter", () => {
    const raw = 'import { foo } from "./bar";\ntest("x", () => {\n  expect(1).toBe(2);\n});\n\nThis test demonstrates the bug by checking that foo returns 2.';
    const result = cleanLlmOutput(raw);
    expect(result).not.toContain("This test demonstrates");
    expect(result).toContain("expect(1).toBe(2)");
  });

  test("handles both preamble and trailing chatter", () => {
    const raw = 'Sure! Here is your test:\n\nimport { x } from "./y";\ntest("a", () => {\n  expect(x()).toBe(1);\n});\n\nLet me know if you need changes.';
    const result = cleanLlmOutput(raw);
    expect(result).not.toContain("Sure!");
    expect(result).not.toContain("Let me know");
    expect(result).toContain("import { x }");
    expect(result).toContain("expect(x()).toBe(1)");
  });

  test("returns empty string for pure prose", () => {
    const raw = "I could not generate a test for this finding.";
    expect(cleanLlmOutput(raw)).toBe("");
  });

  test("returns empty string for very short output", () => {
    expect(cleanLlmOutput("ok")).toBe("");
  });

  test("preserves code with preamble that contains import", () => {
    const raw = 'import { a } from "./a";\nimport { b } from "./b";\ntest("x", () => {});';
    const result = cleanLlmOutput(raw);
    expect(result).toContain('import { a }');
    expect(result).toContain('import { b }');
  });
});
