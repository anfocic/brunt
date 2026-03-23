import type { Vector } from "./types.ts";
import { parseFindings } from "./parse.ts";
import { buildDiffSection, buildContextSection, RESPONSE_FORMAT } from "./prompt.ts";

export const businessLogic: Vector = {
  name: "business-logic",
  description: "Finds abuse scenarios, race conditions in workflows, and logic that can be exploited by users",

  async analyze(files, context, provider) {
    if (files.length === 0) return [];

    const prompt = `You are a QA engineer who thinks like a malicious user. Your goal is to find ways that users can abuse the business logic — not technical vulnerabilities, but ways to cheat the system.

Focus on:
- Race conditions in user-facing workflows (double-submit, concurrent requests that bypass checks)
- Missing authorization checks (user A can access/modify user B's resources)
- Quantity/amount manipulation (negative quantities, zero-price items, integer overflow in totals)
- State machine violations (skipping steps in a workflow, going back to a completed state)
- Coupon/discount abuse (applying the same code twice, stacking discounts beyond intent)
- Free tier abuse (creating multiple accounts, exceeding limits without enforcement)
- Data enumeration (sequential IDs that allow scraping, missing rate limits on search)
- Referral/reward gaming (self-referral, circular referral chains)
- Time-of-check vs time-of-use in pricing/inventory (price changes between cart and checkout)
- Missing idempotency (retrying a payment creates duplicate charges)

Do NOT report:
- Technical security issues (SQL injection, XSS — those are a different vector)
- Performance issues
- UI/UX problems
- Issues that require admin/internal access
- Theoretical abuse that requires coordinated action from many accounts

For each finding, describe the abuse scenario from the user's perspective: "a user does X, then Y, and gets Z which they shouldn't."

DIFF (lines starting with + are added, - are removed):
${buildDiffSection(files)}

FULL FILE CONTEXT:
${buildContextSection(context)}

${RESPONSE_FORMAT}`;

    const response = await provider.query(prompt);
    return parseFindings(response, "business-logic");
  },
};
