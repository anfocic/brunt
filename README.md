# Brunt

Adversarial AI code review. Finds bugs, generates failing tests as proof, auto-fixes and verifies.

Brunt scans your git diffs, runs adversarial analysis via LLM, and for every bug it finds:
1. Generates a failing test that proves the bug exists
2. Generates a fix and verifies it passes the test
3. Optionally opens a PR with all verified fixes

No opinions -- just proof.

## Quick Start

```bash
npm i -g @fole/brunt

# Scan your last commit
brunt scan

# Scan with auto-fix
brunt scan --fix

# Full pipeline: find, prove, fix, open PR
brunt scan --fix --pr
```

## What It Does

```
$ brunt scan --fix

  Running 2 vectors via anthropic:

  + correctness   1 finding (8102ms)
  + security      1 finding (14201ms)

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
```

## Vectors

| Vector | What it finds |
|---|---|
| `correctness` | Edge cases, off-by-one, null handling, type coercion, logic errors, race conditions |
| `security` | SQL injection, XSS, command injection, path traversal, SSRF, auth bypass, hardcoded secrets |
| Custom | Define your own in `brunt.config.yaml` |

```bash
brunt scan --vectors security   # run only security
```

### Custom Vectors

Define domain-specific analysis vectors in `brunt.config.yaml`:

```yaml
vectors:
  - name: api-compat
    description: "Detects breaking API changes"
    prompt: |
      You are reviewing changes for backwards compatibility.
      Focus on removed/renamed public functions, changed signatures,
      changed return types, removed fields from objects.
    severity: high             # optional: minimum severity floor
    include: ["*.ts", "*.js"]  # optional: only analyze matching files
    exclude: ["*.test.ts"]     # optional: skip matching files
```

Custom vectors get all built-in features (caching, batching, canary injection, streaming) for free. Select them by name with `--vectors`:

```bash
brunt scan --vectors correctness,api-compat
```

## Providers

| Provider | Cost | Setup |
|---|---|---|
| `claude-cli` (default) | Free with Claude Code plan | Just have `claude` installed |
| `anthropic` | Pay per token | Set `ANTHROPIC_API_KEY` |
| `ollama` | Free, local | Install Ollama, run `ollama serve` |
| `openai` | Pay per token | Set `OPENAI_API_KEY` |

Any server that speaks the OpenAI chat completions protocol works with `--provider openai`:

| Server | Setup |
|---|---|
| LM Studio | `OPENAI_BASE_URL=http://localhost:1234/v1` |
| llama.cpp | `OPENAI_BASE_URL=http://localhost:8080/v1` |
| vLLM | `OPENAI_BASE_URL=http://localhost:8000/v1` |
| LocalAI | `OPENAI_BASE_URL=http://localhost:8080/v1` |
| Together AI | `OPENAI_BASE_URL=https://api.together.xyz/v1` + `OPENAI_API_KEY` |
| Groq | `OPENAI_BASE_URL=https://api.groq.com/openai/v1` + `OPENAI_API_KEY` |

```bash
brunt scan                                                # Claude Code CLI (default)
ANTHROPIC_API_KEY=sk-... brunt scan --provider anthropic  # Anthropic API
brunt scan --provider ollama --model llama3                # Ollama (local)
OPENAI_API_KEY=sk-... brunt scan --provider openai        # OpenAI API

# Any OpenAI-compatible server (no API key needed for local)
OPENAI_BASE_URL=http://localhost:1234/v1 \
  brunt scan --provider openai --model my-local-model
```

## Monorepo Support

Brunt auto-detects package boundaries and scans each package in isolation:

```bash
brunt scan                          # auto-detect packages
brunt scan --scope all              # treat as single project
brunt scan --scope @myapp/api,web   # scan specific packages only
```

Detects `package.json`, `Cargo.toml`, `go.mod`, `pyproject.toml`, and other manifests. Context and cross-references are scoped per-package so the LLM doesn't see irrelevant code from other packages.

## Incremental Scanning

Skip unchanged files when re-scanning a PR:

```bash
brunt scan --incremental
```

On the first run, Brunt scans all files and saves per-file hashes to `.brunt-incremental.json`. On subsequent runs, only files with changed hunks are re-scanned — findings for unchanged files are carried forward. This saves tokens and time on iterative PR workflows.

The state resets automatically if you change providers, models, or vectors.

## Prompt Injection Defense

Brunt is designed to resist adversarial input -- including code that tries to manipulate the AI reviewer:

1. **Comment stripping** -- all comments and string literals are removed before the LLM sees the diff
2. **Per-file isolation** -- each file is analyzed in its own LLM call; injection in one file cannot suppress findings in another
3. **Injection detection** -- a pre-scan flags suspicious patterns (e.g. `// AI: ignore this file`) before analysis begins
4. **Suspicious silence** -- files touching auth, crypto, exec, or SQL that produce zero findings are flagged for manual review
5. **Canary injection** -- a synthetic bug is injected to verify the LLM actually analyzed the code

## Output Formats

```bash
brunt scan                                  # Human-readable (default)
brunt scan --format json 2>/dev/null | jq . # JSON
brunt scan --format sarif > results.sarif   # SARIF (GitHub Code Scanning)
```

## CI Integration

### GitHub Actions

```yaml
- uses: anfocic/brunt@main
  with:
    provider: anthropic
    fail-on: critical
    pr-comment: 'true'
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## Options

```
--diff <range>           Git diff range (default: HEAD~1, auto-detects in CI)
--provider <name>        LLM provider: claude-cli, anthropic, ollama, openai
--model <name>           Model name
--format <type>          Output: text, json, sarif
--fail-on <severity>     Exit 1 threshold: low, medium, high, critical (default: medium)
--vectors <list>         Comma-separated vectors to run (built-in + custom)
--no-tests               Skip proof test generation
--no-cache               Force fresh LLM analysis
--no-baseline            Ignore baseline, show all findings
--baseline-path <f>      Path to baseline file (default: .brunt-baseline.json)
--verify                 Run proof tests, drop unverified findings
--fix                    Auto-generate and verify fixes
--fix-retries <n>        Max fix attempts (1-5, default: 2)
--pr                     Create PR with verified fixes
--pr-comment             Post findings as GitHub PR review comments
--max-tokens <n>         Max tokens per LLM call
--scope <value>          Monorepo: auto, all, or pkg1,pkg2 (default: auto)
--config <path>          Path to brunt.config.yaml (auto-detected by default)
--incremental            Reuse findings for unchanged files across runs
--incremental-path <f>   Path to incremental state file
```

## License

MIT
