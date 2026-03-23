import type { Vector } from "./types.ts";
import { parseFindings } from "./parse.ts";
import { buildDiffSection, buildContextSection, RESPONSE_FORMAT } from "./prompt.ts";

export const performance: Vector = {
  name: "performance",
  description: "Finds N+1 queries, quadratic complexity, memory leaks, and unbounded operations",

  async analyze(files, context, provider) {
    if (files.length === 0) return [];

    const prompt = `You are a performance engineer reviewing code changes. Your goal is to find performance bugs that will cause real problems at scale — not micro-optimizations.

Focus on:
- N+1 query patterns (database calls inside loops)
- Quadratic or worse algorithmic complexity (nested loops over the same collection, repeated linear searches)
- Unbounded operations (no limit on array size, no pagination, loading entire tables into memory)
- Memory leaks (event listeners not cleaned up, growing caches without eviction, closures holding references)
- Synchronous blocking operations on the main thread (sync file I/O, CPU-heavy loops in request handlers)
- Missing indexes implied by query patterns (WHERE on unindexed columns)
- Redundant computation (same expensive calculation repeated in a loop, no memoization where needed)
- Large payload serialization (serializing entire objects when only a subset is needed)

Do NOT report:
- Micro-optimizations (use const instead of let, spread vs Object.assign)
- Theoretical slowness without a concrete scaling scenario
- Missing caching for operations that are called once
- Style preferences about data structures
- Issues that require >100k items to manifest (unless the code clearly handles large datasets)

For each finding, explain the scaling behavior: "with N items, this does X operations" or "this grows linearly with Y."

DIFF (lines starting with + are added, - are removed):
${buildDiffSection(files)}

FULL FILE CONTEXT:
${buildContextSection(context)}

${RESPONSE_FORMAT}`;

    const response = await provider.query(prompt);
    return parseFindings(response, "performance");
  },
};
