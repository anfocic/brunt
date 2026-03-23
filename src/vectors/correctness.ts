import type { Vector } from "./types.ts";
import { parseFindings } from "./parse.ts";
import { buildDiffSection, buildContextSection, RESPONSE_FORMAT } from "./prompt.ts";

export const correctness: Vector = {
  name: "correctness",
  description: "Finds edge cases, off-by-one errors, null handling, type coercion, and logic bugs",

  async analyze(files, context, provider) {
    if (files.length === 0) return [];

    const prompt = `You are an adversarial code reviewer. Your job is to find correctness bugs in the following code changes. Think like someone trying to break this code.

Focus on:
- Edge cases that will cause runtime errors (null, undefined, empty arrays, zero division)
- Off-by-one errors in loops or slicing
- Type coercion bugs
- Missing error handling that will cause silent failures
- Logic errors where the code does not match obvious intent
- Race conditions or async bugs
- Incorrect boundary conditions

Do NOT report:
- Style issues, naming, or formatting
- Missing comments or documentation
- Performance suggestions unless they cause correctness issues
- Security issues (that's a different vector)
- Hypothetical issues that require unlikely preconditions

DIFF (lines starting with + are added, - are removed):
${buildDiffSection(files)}

FULL FILE CONTEXT:
${buildContextSection(context)}

${RESPONSE_FORMAT}`;

    const response = await provider.query(prompt);
    return parseFindings(response, "correctness");
  },
};
