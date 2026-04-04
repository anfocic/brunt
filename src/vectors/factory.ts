import type { Vector } from "./types.js";
import { parseFindings } from "./parse.js";
import { buildDiffSection, buildContextSection, buildCrossRefSection, RESPONSE_FORMAT } from "./prompt.js";
import { isTTY } from "../tui.js";
import { dim } from "@packages/devkit";

export function createVector(
  name: string,
  description: string,
  promptBody: string
): Vector {
  const systemPrompt = `${promptBody}\n\n${RESPONSE_FORMAT}`;

  return {
    name,
    description,
    async analyze(files, context, provider, crossRefs) {
      if (files.length === 0) return [];

      const crossRefSection = crossRefs && crossRefs.length > 0
        ? `\nCROSS-REFERENCE CALLERS (other files that use changed symbols — check for breakage):\n${buildCrossRefSection(crossRefs)}\n`
        : "";

      const userPrompt = `DIFF (lines starting with + are added, - are removed):
${buildDiffSection(files)}

FULL FILE CONTEXT:
${buildContextSection(context)}
${crossRefSection}
JSON array:`;

      if (provider.queryStream && isTTY()) {
        return analyzeWithStream(systemPrompt, userPrompt, provider, name);
      }

      const response = await provider.queryRich(systemPrompt, userPrompt);
      return parseFindings(response.text, name);
    },
  };
}

async function analyzeWithStream(
  system: string,
  userPrompt: string,
  provider: { queryStream?(p: string): AsyncIterable<string> },
  vectorName: string
) {
  // Streaming uses single prompt — it's just for TTY preview, not the primary path.
  // The system prompt benefit (Anthropic caching) applies to queryRich calls above.
  const combined = `${system}\n\n${userPrompt}`;
  let response = "";
  let chars = 0;
  const maxPreview = 120;

  for await (const chunk of provider.queryStream!(combined)) {
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
