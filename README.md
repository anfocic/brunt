# Vigil

Adversarial AI code review. Finds bugs, generates failing tests as proof.

Vigil scans your git diffs, runs adversarial analysis via LLM, and outputs
committable test files that prove the bugs it finds. No opinions — just proof.

## Quick Start

```bash
# Install
npm i -g vigil-review

# Scan your last commit (uses Claude Code CLI — free with Max plan)
vigil scan

# Scan staged changes
vigil scan --diff --cached

# Scan a PR range
vigil scan --diff origin/main..HEAD
```

## What It Does

```
$ vigil scan --diff HEAD~1

Parsing diff...
Analyzing 3 files...
Running 2 vectors via claude-cli...
Found 2 issues. Generating proof tests...

vigil — found 2 issues (14230ms)

[correctness] 1 finding (8102ms)

  HIGH src/utils.ts:23
  parseInt without radix or NaN handling
  parseInt('abc') returns NaN which propagates silently.
  Reproduction: Call parseAge('abc') — returns NaN instead of throwing
  Test: tests/vigil/src-utils-ts-L23.test.ts

[security] 1 finding (14201ms)

  CRITICAL src/api/users.ts:34
  SQL injection in user search endpoint
  Query parameter interpolated directly into SQL string.
  Reproduction: curl 'localhost:3000/api/users?q=1' OR 1=1--'
  Test: tests/vigil/src-api-users-ts-L34.test.ts
```

Every finding includes a generated test file you can run immediately.

## Vectors

Vigil runs multiple analysis vectors in parallel:

| Vector | What it finds |
|---|---|
| `correctness` | Edge cases, off-by-one, null handling, type coercion, logic errors |
| `security` | SQL injection, XSS, command injection, path traversal, SSRF, hardcoded secrets |

```bash
# Run all vectors (default)
vigil scan

# Run specific vectors
vigil scan --vectors security
vigil scan --vectors correctness,security

# List available vectors
vigil list
```

## Providers

Vigil works with your existing Claude setup — no extra API key needed.

| Provider | Cost | Setup |
|---|---|---|
| `claude-cli` (default) | Free with Claude Code plan | Just have `claude` installed |
| `anthropic` | Pay per token | Set `ANTHROPIC_API_KEY` env var |

```bash
# Uses your Claude Code subscription (default)
vigil scan

# Uses Anthropic API directly
ANTHROPIC_API_KEY=sk-... vigil scan --provider anthropic
```

## CI Integration

### GitHub Actions

```yaml
name: Vigil Review
on: [pull_request]

jobs:
  vigil:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Install Vigil
        run: npm i -g vigil-review

      - name: Run Vigil
        run: vigil scan --diff origin/main..HEAD --no-tests --fail-on critical
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

### Exit Codes

| Code | Meaning |
|---|---|
| 0 | No findings above threshold |
| 1 | Findings at or above `--fail-on` severity |
| 2 | Vigil error (config, provider, etc.) |

## Options

```
--diff <range>        Git diff range (default: HEAD~1)
--provider <name>     LLM provider: claude-cli, anthropic (default: claude-cli)
--format <type>       Output format: text, json (default: text)
--fail-on <severity>  Exit 1 at this severity: low, medium, high, critical (default: medium)
--vectors <list>      Comma-separated vectors to run (default: all)
--no-tests            Skip proof test generation (faster, good for CI)
```

## JSON Output

```bash
vigil scan --format json 2>/dev/null | jq .
```

Progress messages go to stderr, JSON goes to stdout — safe to pipe.

## How It Works

1. Parses your git diff into structured file changes
2. Reads full file context for changed files
3. Runs selected vectors in parallel — each sends the diff + context to an LLM with an adversarial prompt
4. Parses findings from LLM responses (strict JSON validation, malformed findings are dropped)
5. For each finding, generates a proof test using a second LLM call that detects your test framework
6. Writes test files and outputs a report

## Development

```bash
git clone https://github.com/your-org/vigil.git
cd vigil
bun install
bun test
bun run src/cli.ts scan
```

## License

MIT
