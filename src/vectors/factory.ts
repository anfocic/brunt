import type { Vector } from "./types.js";
import { parseFindings } from "./parse.js";
import { buildDiffSection, buildContextSection, RESPONSE_FORMAT } from "./prompt.js";
import { isTTY } from "../tui.js";
import { dim } from "@packages/devkit";

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

      if (provider.queryStream && isTTY()) {
        return analyzeWithStream(prompt, provider, name);
      }

      const response = await provider.query(prompt);
      return parseFindings(response, name);
    },
  };
}

async function analyzeWithStream(
  prompt: string,
  provider: { queryStream?(p: string): AsyncIterable<string> },
  vectorName: string
) {
  let response = "";
  let chars = 0;
  const maxPreview = 120;

  for await (const chunk of provider.queryStream!(prompt)) {
    response += chunk;
    chars += chunk.length;

    if (chars <= maxPreview) {
      const preview = response.replace(/\n/g, " ").slice(0, maxPreview);
      process.stderr.write(`\x1b[2K\r    ${dim(preview + (chars >= maxPreview ? "..." : ""))}`);
    }
  }

  process.stderr.write("\x1b[2K\r");
  return parseFindings(response, vectorName);
}
