import type { DiffFile } from "../diff.ts";
import type { Vector } from "./types.ts";
import { parseFindings } from "./parse.ts";

function buildPrompt(files: DiffFile[], context: Map<string, string>): string {
  let diffSection = "";
  for (const file of files) {
    diffSection += `\n--- ${file.path} (${file.language}) ---\n`;
    for (const hunk of file.hunks) {
      if (hunk.removed.length) diffSection += hunk.removed.map((l) => `- ${l}`).join("\n") + "\n";
      if (hunk.added.length) diffSection += hunk.added.map((l) => `+ ${l}`).join("\n") + "\n";
    }
  }

  let contextSection = "";
  for (const [path, content] of context) {
    contextSection += `\n--- ${path} (full file) ---\n${content}\n`;
  }

  return `You are a security researcher performing an adversarial review of code changes. Your goal is to find exploitable vulnerabilities that a real attacker could use.

Focus on:
- SQL injection (string concatenation in queries, missing parameterization)
- Command injection (unsanitized input passed to shell/exec/spawn)
- XSS (user input rendered without escaping in HTML/templates/JSX)
- Path traversal (user input in file paths without sanitization)
- Authentication/authorization bypasses (missing auth checks, broken access control)
- Sensitive data exposure (secrets in code, PII in logs, tokens in URLs)
- Insecure deserialization (JSON.parse on untrusted input used unsafely)
- SSRF (user-controlled URLs in server-side requests)
- Race conditions that bypass security checks (TOCTOU)
- Hardcoded credentials, API keys, or secrets

Do NOT report:
- Missing HTTPS (infrastructure concern)
- Generic "input validation" without a specific attack vector
- Theoretical attacks that require unlikely preconditions
- Dependency vulnerabilities (use a scanner for that)
- Code quality or style issues

For each finding, you MUST describe a specific attack scenario — not just "this could be vulnerable" but "an attacker sends X and gets Y."

DIFF (lines starting with + are added, - are removed):
${diffSection}

FULL FILE CONTEXT:
${contextSection}

Respond with ONLY a JSON array of findings. If there are no issues, respond with an empty array [].
Each finding must have:
- "file": the file path
- "line": approximate line number in the new version
- "severity": one of "low", "medium", "high", "critical"
- "title": short description (under 80 chars)
- "description": detailed explanation of the vulnerability and attack scenario
- "reproduction": a specific curl command, input, or step-by-step to exploit it

Example:
[
  {
    "file": "src/api/users.ts",
    "line": 34,
    "severity": "critical",
    "title": "SQL injection in user search endpoint",
    "description": "The search query parameter is interpolated directly into the SQL string without parameterization. An attacker can extract the entire database by injecting UNION SELECT statements.",
    "reproduction": "curl 'https://localhost:3000/api/users?q=1%27%20UNION%20SELECT%20username,password%20FROM%20users--'"
  }
]

JSON array:`;
}

export const security: Vector = {
  name: "security",
  description: "Finds injection, auth bypass, data exposure, and other exploitable vulnerabilities",

  async analyze(files, context, provider) {
    if (files.length === 0) return [];

    const prompt = buildPrompt(files, context);
    const response = await provider.query(prompt);
    return parseFindings(response, "security");
  },
};
