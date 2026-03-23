import type { Vector } from "./types.ts";
import { parseFindings } from "./parse.ts";
import { buildDiffSection, buildContextSection, RESPONSE_FORMAT } from "./prompt.ts";

export const resilience: Vector = {
  name: "resilience",
  description: "Finds missing error handling, unhandled promises, timeout gaps, and failure modes",

  async analyze(files, context, provider) {
    if (files.length === 0) return [];

    const prompt = `You are a reliability engineer reviewing code changes. Your goal is to find failure modes — places where the code will break in production when things go wrong.

Focus on:
- Unhandled promise rejections (async calls without catch, missing try/catch around await)
- Missing error handling on external calls (API requests, database queries, file operations that assume success)
- No timeouts on network requests (HTTP calls, database connections that can hang forever)
- No retries on transient failures (network errors, rate limits treated as permanent failures)
- Silent error swallowing (empty catch blocks, catch that logs but doesn't propagate or handle)
- Missing fallbacks (single point of failure with no degraded mode)
- Resource cleanup failures (opened connections/files not closed on error path)
- Cascading failure risks (one slow dependency blocks everything, no circuit breaker)
- Missing input validation at system boundaries (API endpoints, message queue consumers, webhook handlers)
- Partial failure states (batch operations where some items succeed and some fail, leaving inconsistent state)

Do NOT report:
- Missing error handling on internal pure functions (they won't throw in practice)
- Theoretical failures that require infrastructure to be completely down
- Missing retries on operations that should not be retried (non-idempotent writes)
- Logging style preferences
- Test code error handling

For each finding, describe the failure scenario: "when X fails/times out, Y happens (or doesn't happen)."

DIFF (lines starting with + are added, - are removed):
${buildDiffSection(files)}

FULL FILE CONTEXT:
${buildContextSection(context)}

${RESPONSE_FORMAT}`;

    const response = await provider.query(prompt);
    return parseFindings(response, "resilience");
  },
};
