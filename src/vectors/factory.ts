import type { Vector } from "./types.ts";
import { parseFindings } from "./parse.ts";
import { buildDiffSection, buildContextSection, RESPONSE_FORMAT } from "./prompt.ts";

export function createVector(
  name: string,
  description: string,
  promptBody: string
): Vector {
  return {
    name,
    description,
    async analyze(files, context, provider) {
      if (files.length === 0) return [];

      const prompt = `${promptBody}

DIFF (lines starting with + are added, - are removed):
${buildDiffSection(files)}

FULL FILE CONTEXT:
${buildContextSection(context)}

${RESPONSE_FORMAT}`;

      const response = await provider.query(prompt);
      return parseFindings(response, name);
    },
  };
}
