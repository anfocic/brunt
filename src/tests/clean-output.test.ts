import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { cleanLlmResponse as cleanLlmOutput } from "../util.js";

describe("cleanLlmOutput", () => {
  test("returns clean code as-is", () => {
    const code = 'import { foo } from "./bar";\n\ntest("works", () => {\n  expect(foo()).toBe(1);\n});\n';
    assert.strictEqual(cleanLlmOutput(code), code);
  });

  test("strips markdown fences", () => {
    const raw = '```typescript\nimport { x } from "./y";\ntest("a", () => {});\n```';
    const result = cleanLlmOutput(raw);
    assert.ok(!result.includes("```"));
    assert.ok(result.includes('import { x }'));
  });

  test("removes preamble chatter", () => {
    const raw = 'Here is the test file:\n\nimport { foo } from "./bar";\ntest("x", () => {\n  expect(1).toBe(2);\n});';
    const result = cleanLlmOutput(raw);
    assert.ok(!result.includes("Here is"));
    assert.ok(result.includes("import { foo }"));
  });

  test("removes trailing chatter", () => {
    const raw = 'import { foo } from "./bar";\ntest("x", () => {\n  expect(1).toBe(2);\n});\n\nThis test demonstrates the bug by checking that foo returns 2.';
    const result = cleanLlmOutput(raw);
    assert.ok(!result.includes("This test demonstrates"));
    assert.ok(result.includes("expect(1).toBe(2)"));
  });

  test("handles both preamble and trailing chatter", () => {
    const raw = 'Sure! Here is your test:\n\nimport { x } from "./y";\ntest("a", () => {\n  expect(x()).toBe(1);\n});\n\nLet me know if you need changes.';
    const result = cleanLlmOutput(raw);
    assert.ok(!result.includes("Sure!"));
    assert.ok(!result.includes("Let me know"));
    assert.ok(result.includes("import { x }"));
    assert.ok(result.includes("expect(x()).toBe(1)"));
  });

  test("returns empty string for pure prose", () => {
    const raw = "I could not generate a test for this finding.";
    assert.strictEqual(cleanLlmOutput(raw), "");
  });

  test("returns empty string for very short output", () => {
    assert.strictEqual(cleanLlmOutput("ok"), "");
  });

  test("preserves code with preamble that contains import", () => {
    const raw = 'import { a } from "./a";\nimport { b } from "./b";\ntest("x", () => {});';
    const result = cleanLlmOutput(raw);
    assert.ok(result.includes('import { a }'));
    assert.ok(result.includes('import { b }'));
  });
});
