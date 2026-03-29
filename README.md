# Brunt

Adversarial AI code review. Finds bugs, generates failing tests as proof, auto-fixes and verifies.

Brunt scans your git diffs, runs adversarial analysis via LLM, and for every bug it finds:
1. Generates a failing test that proves the bug exists
2. Generates a fix and verifies it passes the test
3. Optionally opens a PR with all verified fixes

No opinions -- just proof.

## Quick Start

```bash
npm i -g brunt-cli

# See it in action instantly (no setup needed)
brunt demo

# Scan your last commit
brunt scan

# Scan with auto-fix
brunt scan --fix

# Full pipeline: find, prove, fix, open PR
brunt scan --fix --pr
```

## Demo

```bash
# Zero-setup showcase: scans a built-in buggy file, finds 3 bugs, proves them, fixes them
brunt demo

# Use a specific provider
brunt demo --provider anthropic
```

The demo creates a temp repo with a known-buggy file (off-by-one, SQL injection, negative refund exploit), runs the full scan+fix pipeline, and shows results.

## What It Does

```
$ brunt scan --fix

  ___  ___  _ _ _  _ _____
 | _ )| _ \| | | || |_   _|
 | _ \|   /| |_| || | | |
 |___/|_|_\ \___/ |_| |_|
  adversarial AI code review  v0.4.0

+ Parsed 3 files.

  Running 5 vectors via claude-cli:

  + correctness   1 finding (8102ms)
  + security      1 finding (14201ms)
  + performance   0 findings (9800ms)
  + resilience    0 findings (7540ms)
  + business-logic 0 findings (11300ms)

+ Generated 2 proof tests.
+ Verified 2 fixes.

brunt -- found 2 issues (14230ms)

[correctness] 1 finding (8102ms)

  HIGH src/utils.ts:23  [FIXED]
  parseInt without radix or NaN handling
  Test: tests/brunt/src-utils-ts-L23.test.ts

  --- fix diff ---
  -  const age = parseInt(input);
  +  const age = parseInt(input, 10);
  +  if (isNaN(age)) throw new Error('Invalid age');

[security] 1 finding (14201ms)

  CRITICAL src/api/users.ts:34  [FIXED]
  SQL injection in user search endpoint
  Test: tests/brunt/src-api-users-ts-L34.test.ts

  --- fix diff ---
  -  const query = `SELECT * FROM users WHERE name = '${input}'`;
  +  const query = `SELECT * FROM users WHERE name = $1`;

----------------------------------------
  1 critical  1 high  |  14230ms
  2 fixed
----------------------------------------
```

## Features

### Auto-Fix + Verify Loop

```bash
brunt scan --fix                  # Find, prove, fix, verify
brunt scan --fix --fix-retries 3  # Allow up to 3 fix attempts per bug
```

For each bug found, brunt:
1. Generates a proof test (fails against buggy code)
2. Asks the LLM to generate a fix
3. Applies the fix and runs the proof test
4. If the test passes: fix is verified. If not: rolls back and retries.

### Interactive Mode

```bash
brunt scan --interactive
```

After scanning, enter an interactive REPL to triage findings:
- Select findings by number
- `explain` -- ask AI for a detailed explanation
- `fix` -- generate and verify a fix
- `accept` / `dismiss` -- triage findings
- `quit` -- exit with summary

### Multi-Model Consensus

```bash
brunt scan --consensus                                    # Auto-pick additional models
brunt scan --consensus --consensus-providers anthropic,ollama  # Specify models
```

Runs the same scan across multiple LLM providers and shows agreement:
- `[2/2]` -- both models found this bug (high confidence)
- `[1/2]` -- only one model found it (lower confidence)

### Fix and PR

```bash
brunt scan --fix --pr
```

After verifying fixes:
1. Creates a `brunt/fix-<timestamp>` branch
2. Commits all verified fixes
3. Pushes and opens a PR via `gh`

### Streaming

All providers support streaming (`queryStream`) for real-time AI output during analysis.

## Vectors

Brunt runs 5 analysis vectors in parallel:

| Vector | What it finds |
|---|---|
| `correctness` | Edge cases, off-by-one, null handling, type coercion, logic errors |
| `security` | SQL injection, XSS, command injection, path traversal, SSRF, hardcoded secrets |
| `performance` | N+1 queries, quadratic complexity, memory leaks, unbounded operations |
| `resilience` | Missing error handling, unhandled promises, timeouts, cascading failures |
| `business-logic` | Abuse scenarios, race conditions, quantity manipulation, state machine violations |

```bash
brunt scan --vectors security
brunt scan --vectors correctness,security
brunt list
```

## Providers

| Provider | Cost | Setup |
|---|---|---|
| `claude-cli` (default) | Free with Claude Code plan | Just have `claude` installed |
| `anthropic` | Pay per token | Set `ANTHROPIC_API_KEY` env var |
| `ollama` | Free, runs locally | Install Ollama, run `ollama serve` |

```bash
brunt scan                                              # Claude Code CLI (default)
ANTHROPIC_API_KEY=sk-... brunt scan --provider anthropic  # Anthropic API
brunt scan --provider ollama --model llama3              # Local model
```

## Config File

Create `brunt.config.yaml` in your project root:

```yaml
provider: anthropic
model: claude-sonnet-4-6-20250514
format: text
failOn: medium
maxTokens: 4096
concurrency: 3
fix: true
fixRetries: 2

vectors:
  - correctness
  - security

sensitive:
  enabled: true
  patterns:
    - "*.secret"
```

## Output Formats

```bash
brunt scan                                # Human-readable (default)
brunt scan --format json 2>/dev/null | jq . # JSON
brunt scan --format sarif > results.sarif    # SARIF (GitHub Code Scanning)
```

## Git Hook

```bash
brunt init  # Install pre-push hook
```

## CI Integration

### GitHub Actions

```yaml
name: Brunt
on: [pull_request]

jobs:
  review:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
      security-events: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: anfocic/brunt@main
        with:
          provider: anthropic
          fail-on: critical
          pr-comment: 'true'
          sarif-upload: 'true'
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## Caching

Brunt caches scan results in `.brunt-cache/`. Same diff + vectors + provider = instant results.

```bash
brunt scan --no-cache  # Force fresh analysis
```

## Prompt Injection Defense

- Injects a synthetic canary bug and verifies the LLM detects it
- Two-pass verification prevents false positives
- All comments stripped from diff before LLM analysis

## All Options

```
--diff <range>            Git diff range (default: HEAD~1, auto-detects in CI)
--provider <name>         LLM provider: claude-cli, anthropic, ollama
--model <name>            Model name
--format <type>           Output: text, json, sarif
--fail-on <severity>      Exit 1 threshold: low, medium, high, critical
--vectors <list>          Comma-separated vectors to run
--no-tests                Skip proof test generation
--no-cache                Force fresh LLM analysis
--pr-comment              Post findings as GitHub PR review comments
--max-tokens <n>          Max tokens per LLM call
--fix                     Auto-generate and verify fixes
--fix-retries <n>         Max fix attempts (1-5, default: 2)
--interactive             Interactive triage mode
--pr                      Create PR with verified fixes (requires --fix)
--consensus               Run across multiple models for agreement
--consensus-providers     Comma-separated providers for consensus
```

### Exit Codes

| Code | Meaning |
|---|---|
| 0 | No findings above threshold |
| 1 | Findings at or above `--fail-on` severity |
| 2 | Brunt error |

## Development

```bash
git clone https://github.com/anfocic/brunt.git
cd brunt
bun install
bun test
bun run src/cli.ts scan
```

## License

MIT
