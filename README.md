# Brunt

Adversarial AI code review. Finds bugs, generates failing tests as proof.

Brunt scans your git diffs, runs adversarial analysis via LLM, and outputs
committable test files that prove the bugs it finds. No opinions -- just proof.

## Quick Start

```bash
npm i -g brunt

# Scan your last commit
brunt scan

# Scan staged changes
brunt scan --diff --cached

# Scan a PR range
brunt scan --diff origin/main..HEAD
```

## What It Does

```
$ brunt scan

Parsing diff...
Analyzing 3 files...
Running 5 vectors via claude-cli...
  correctness: 1 finding (8102ms)
  security: 1 finding (14201ms)
  performance: 0 findings (9800ms)
  resilience: 0 findings (7540ms)
  business-logic: 0 findings (11300ms)
Found 2 issues. Generating proof tests...

brunt -- found 2 issues (14230ms)

[correctness] 1 finding (8102ms)

  HIGH src/utils.ts:23
  parseInt without radix or NaN handling
  parseInt('abc') returns NaN which propagates silently.
  Reproduction: Call parseAge('abc') -- returns NaN instead of throwing
  Test: tests/brunt/src-utils-ts-L23.test.ts

[security] 1 finding (14201ms)

  CRITICAL src/api/users.ts:34
  SQL injection in user search endpoint
  Query parameter interpolated directly into SQL string.
  Reproduction: curl 'localhost:3000/api/users?q=1' OR 1=1--'
  Test: tests/brunt/src-api-users-ts-L34.test.ts
```

Every finding includes a generated test file you can run immediately.

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
# Run all vectors (default)
brunt scan

# Run specific vectors
brunt scan --vectors security
brunt scan --vectors correctness,security

# List available vectors
brunt list
```

## Providers

| Provider | Cost | Setup |
|---|---|---|
| `claude-cli` (default) | Free with Claude Code plan | Just have `claude` installed |
| `anthropic` | Pay per token | Set `ANTHROPIC_API_KEY` env var |
| `ollama` | Free, runs locally | Install Ollama, run `ollama serve` |

```bash
# Claude Code CLI (default)
brunt scan

# Anthropic API
ANTHROPIC_API_KEY=sk-... brunt scan --provider anthropic

# Local model via Ollama
brunt scan --provider ollama --model llama3
```

Ollama supports any model you've pulled. Set `OLLAMA_HOST` to point to a remote instance.

## Config File

Create `brunt.config.yaml` in your project root to set defaults. CLI flags override config.

```yaml
provider: anthropic
model: claude-sonnet-4-6-20250514
format: text
failOn: medium
maxTokens: 4096
concurrency: 3

vectors:
  - correctness
  - security

sensitive:
  enabled: true
  patterns:
    - "*.secret"
```

Config is searched from the current directory up to the git root.

## Output Formats

```bash
# Human-readable (default)
brunt scan

# JSON (pipe-friendly, progress goes to stderr)
brunt scan --format json 2>/dev/null | jq .

# SARIF (GitHub Code Scanning, VS Code, SonarQube)
brunt scan --format sarif > results.sarif
```

## Git Hook

```bash
# Install a pre-push hook that scans before every push
brunt init
```

The hook runs `brunt scan --no-tests` using your `brunt.config.yaml` defaults.
Push with `--no-verify` to skip.

## CI Integration

### GitHub Actions (simple)

```yaml
name: Brunt
on: [pull_request]

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Run Brunt
        run: npx brunt scan --no-tests --fail-on critical
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

Brunt auto-detects `GITHUB_BASE_REF` in pull requests, so `--diff` is optional.

### GitHub Actions (with PR comments + SARIF)

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

This posts inline review comments on the PR and uploads findings to the GitHub Security tab.

### PR Comments

```bash
# Requires GITHUB_TOKEN, GITHUB_REPOSITORY, and BRUNT_PR_NUMBER
brunt scan --pr-comment
```

Posts a GitHub PR review with inline comments per finding. Approves if clean, requests changes if issues found.

## Caching

Brunt caches scan results in `.brunt-cache/`. If the same diff, vectors, provider, and model are used again, the cached findings are returned instantly without calling the LLM.

```bash
# Force fresh analysis
brunt scan --no-cache
```

Add `.brunt-cache/` to your `.gitignore` (the default `.gitignore` already excludes it).

## Sensitive Files

By default, brunt excludes sensitive files from the diff sent to the LLM:

`.env`, `.env.*`, `*secret*`, `*credential*`, `*password*`, `*.pem`, `*.key`, `*.p12`, `id_rsa*`, `*.keystore`

Add custom patterns or disable filtering in `brunt.config.yaml`:

```yaml
sensitive:
  enabled: false  # disable filtering
  patterns:       # add extra patterns
    - "*.private"
```

## Prompt Injection Defense

Brunt injects a synthetic canary bug into every scan and verifies the LLM detects it. If the canary is missed, brunt warns that the analysis may have been compromised. A second LLM call confirms the canary wasn't a false positive.

All comments are stripped from the diff before sending to the LLM to prevent injection via code comments.

## Options

```
--diff <range>        Git diff range (default: HEAD~1, auto-detects in CI)
--provider <name>     LLM provider: claude-cli, anthropic, ollama (default: claude-cli)
--model <name>        Model name (e.g. llama3, claude-sonnet-4-6-20250514)
--format <type>       Output format: text, json, sarif (default: text)
--fail-on <severity>  Exit 1 at this severity: low, medium, high, critical (default: medium)
--vectors <list>      Comma-separated vectors to run (default: all)
--no-tests            Skip proof test generation
--no-cache            Force fresh LLM analysis
--pr-comment          Post findings as GitHub PR review comments
--max-tokens <n>      Maximum tokens per LLM call
```

### Exit Codes

| Code | Meaning |
|---|---|
| 0 | No findings above threshold |
| 1 | Findings at or above `--fail-on` severity |
| 2 | Brunt error (config, provider, etc.) |

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
