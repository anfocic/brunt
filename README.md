# Brunt

Adversarial AI code review. Finds bugs, generates failing tests as proof.

Brunt scans your git diffs, runs adversarial analysis via LLM, and outputs
committable test files that prove the bugs it finds. No opinions — just proof.

## Quick Start

```bash
# Install
npm i -g brunt

# Scan your last commit (uses Claude Code CLI — free with Max plan)
brunt scan

# Scan staged changes
brunt scan --diff --cached

# Scan a PR range
brunt scan --diff origin/main..HEAD
```

## What It Does

```
$ brunt scan --diff HEAD~1

Parsing diff...
Analyzing 3 files...
Running 2 vectors via claude-cli...
Found 2 issues. Generating proof tests...

brunt — found 2 issues (14230ms)

[correctness] 1 finding (8102ms)

  HIGH src/utils.ts:23
  parseInt without radix or NaN handling
  parseInt('abc') returns NaN which propagates silently.
  Reproduction: Call parseAge('abc') — returns NaN instead of throwing
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

Brunt runs multiple analysis vectors in parallel:

| Vector | What it finds |
|---|---|
| `correctness` | Edge cases, off-by-one, null handling, type coercion, logic errors |
| `security` | SQL injection, XSS, command injection, path traversal, SSRF, hardcoded secrets |

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

Brunt works with your existing Claude setup — no extra API key needed.

| Provider | Cost | Setup |
|---|---|---|
| `claude-cli` (default) | Free with Claude Code plan | Just have `claude` installed |
| `anthropic` | Pay per token | Set `ANTHROPIC_API_KEY` env var |

```bash
# Uses your Claude Code subscription (default)
brunt scan

# Uses Anthropic API directly
ANTHROPIC_API_KEY=sk-... brunt scan --provider anthropic
```

## CI Integration

### GitHub Actions

```yaml
name: Brunt Review
on: [pull_request]

jobs:
  brunt:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Install Brunt
        run: npm i -g brunt

      - name: Run Brunt
        run: brunt scan --diff origin/main..HEAD --no-tests --fail-on critical
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

### Exit Codes

| Code | Meaning |
|---|---|
| 0 | No findings above threshold |
| 1 | Findings at or above `--fail-on` severity |
| 2 | Brunt error (config, provider, etc.) |

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
brunt scan --format json 2>/dev/null | jq .
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
git clone https://github.com/your-org/brunt.git
cd brunt
bun install
bun test
bun run src/cli.ts scan
```

## License

MIT
