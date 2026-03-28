# Brunt v0.4 Showcase Notes

Raw material for blog post. Real numbers, real output, real bugs found.

## The Pitch

Brunt is an adversarial AI code review tool that doesn't just find bugs -- it proves them with failing tests, generates fixes, and verifies the fixes pass. The full autonomous loop: **find -> prove -> fix -> verify -> PR**.

Zero runtime dependencies. 102KB bundle. 202 tests. Ships as a single file.

## The Numbers

| Metric | Value |
|--------|-------|
| Bundle size | 102KB (single ESM file) |
| Runtime deps | 0 |
| Test count | 202 |
| Source files | 22 |
| Source lines | ~3,200 |
| Analysis vectors | 5 (correctness, security, performance, resilience, business-logic) |
| Providers | 3 (Claude CLI, Anthropic API, Ollama) |
| Output formats | 3 (text, JSON, SARIF) |

## Real Scan: Brunt Scanning Itself

### Setup
- Provider: Anthropic API (claude-sonnet-4-6)
- Diff: HEAD~3 (15 files changed)
- Vectors: correctness + security
- No test generation (just findings)

### Results
- **8 correctness findings** in 57 seconds
- Security vector hit rate limit (30k input tokens/min) -- the diffs were large
- Canary warning fired (expected -- canary is defense-in-depth)

### Findings Brunt Found In Its Own Code

| Severity | File | Bug |
|----------|------|-----|
| HIGH | providers/claude-cli.ts | `queryStream` silently swallows child process errors. If `claude` isn't installed, the generator returns empty instead of throwing. Process crashes on ENOENT. |
| HIGH | providers/claude-cli.ts | Timeout kills process but `queryStream` doesn't throw a timeout error. `query()` does throw -- inconsistent behavior. |
| MEDIUM | runner.ts | Consensus runs without canary injection. Secondary providers scan slightly different input than primary. |
| MEDIUM | cli.ts | `--consensus-providers` with no argument gives misleading "Unknown flag" error instead of "missing value". |
| MEDIUM | config.ts | YAML parser loses array values in edge case: nested array followed by nested key-value under same parent. |
| MEDIUM | runner.ts | Consensus runs after output, re-reads files. Working tree changes between scan and consensus would cause inconsistency. |
| LOW | runner.ts | `createFixPr` receives full fixes array including failed ones. Should only get verified fixes. |
| LOW | reporter.ts | `formatJson` used raw string interpolation instead of `findingKey()` for fix lookup -- would break if key format changed. |

### Bugs We Fixed On The Spot
Two findings were immediately actionable:
1. **formatJson key mismatch** -- `fixMap.get(\`${f.file}:${f.line}\`)` instead of `fixMap.get(findingKey(f))`. Would cause all fix data to be missing from JSON output if `findingKey` ever changed.
2. **createFixPr unfiltered array** -- passed all fixes (including failed) to PR creation. Could commit broken patches.

Both fixed in under a minute after brunt flagged them.

## The Self-Review Story

During development, we ran brunt's code through a review agent at each phase:

### Phase 1 Review (Auto-Fix + TUI)
Found **4 critical bugs**:
- **Race condition in `fixAll`**: Multiple findings for the same file ran `fixAndVerify` concurrently. Two parallel fixes would read/write/rollback the same file, corrupting the working tree. Fixed by grouping findings per file and processing sequentially within groups.
- **Path traversal in `applyFix`**: `finding.file` comes from LLM output. A malicious/hallucinated path like `../../.bashrc` would write LLM content anywhere on disk. Fixed with `validateFilePath()` that checks the resolved path stays within the project root.
- **Wrong output cleaner**: `cleanLlmOutput` was designed for test code (looks for `import`, `describe`, `test`). Used for source code fixes, it would strip valid lines starting with `pub fn`, `class`, `def`, etc. Fixed with a broader `cleanLlmResponse` that handles any language.
- **Broken diff generator**: `generateDiff` computed LCS twice (once with space-optimized DP that can't backtrack, then again with full table). 15 lines of dead code, plus `hunkPatchLen` computed and immediately voided.

### Phase 2+3 Review
Found **24 issues total** (4 critical, 5 high, 9 medium, 6 low):
- PR creation leaves user on fix branch (now checks out base after PR)
- Detached HEAD crashes PR flow (now throws clear error)
- Async readline race in interactive mode (added processing lock)
- LLM content unsanitized in PR body (added markdown escaping)
- Interactive `fixed` array included failed fix attempts
- Consensus dedup key lacked vector name (cross-vector collision)

### Code Quality Review
Found **24 structural issues**, fixed the top ones:
- ANSI colors defined in 3 files -> extracted to `src/colors.ts`
- `cleanFixOutput` + `cleanLlmOutput` nearly identical -> merged into `cleanLlmResponse` in `src/util.ts`
- `pMap` living in test-gen.ts but used by fix-gen -> moved to `src/util.ts`
- `findingKey` pattern (`${f.file}:${f.line}`) repeated 5+ places -> shared function
- `generateDiff` + `computeLcs` (130 lines) bloating fix-gen.ts -> extracted to `src/diff-gen.ts`
- `run()` was 222 lines -> extracted `runConsensus()`, hoisted redundant calls
- Ollama ignored `options.timeout` unlike other providers -> fixed
- `err: any` in provider catch blocks -> `err: unknown` with proper guards

## Feature List (v0.4)

### Find -> Prove -> Fix -> Verify (The Loop)
```bash
brunt scan --fix
```
1. Scans diff with 5 parallel analysis vectors
2. For each bug: generates a failing test (proof)
3. Asks LLM to generate a fix
4. Applies fix, runs the proof test
5. If test passes: fix verified. If not: rollback, retry (up to N times)
6. Reports which bugs were fixed with before/after diffs

### Demo Mode
```bash
brunt demo
```
Creates a temp repo with a known-buggy file (off-by-one, SQL injection, negative refund), runs the full pipeline. Anyone can see it work in ~60 seconds without their own repo.

### Interactive Triage
```bash
brunt scan --interactive
```
REPL after scan: select findings by number, ask AI to explain, trigger fixes, accept/dismiss. Conversational code review.

### Multi-Model Consensus
```bash
brunt scan --consensus
```
Runs the same scan across multiple LLM providers. Shows agreement: `[2/2 models]` = high confidence. Findings confirmed by multiple models get highlighted.

### Fix and PR
```bash
brunt scan --fix --pr
```
After verifying fixes: creates branch, commits, pushes, opens PR via `gh`. Full autonomous developer pipeline.

### Rich Terminal UX
- Animated braille spinner during LLM calls
- Multi-line progress board for parallel vectors (each line updates in-place)
- Color-coded severity badges
- Inline diff display for verified fixes (green/red)
- Summary dashboard with severity breakdown
- ASCII art banner
- CI-safe: plain text fallback when not a TTY

### Streaming
All 3 providers support `queryStream()` returning `AsyncIterable<string>`:
- Anthropic: SSE parsing (`stream: true`)
- Ollama: line-delimited JSON
- Claude CLI: spawn with stdout pipe

## Architecture

```
CLI (cli.ts)
  -> Runner (runner.ts) -- orchestrator
    -> Diff Parser (diff.ts)
    -> Sanitizer (sanitize.ts) -- strip comments
    -> Canary (canary.ts) -- prompt injection defense
    -> 5 Vectors in parallel (vectors/*.ts)
      -> Provider.query() -> LLM
      -> Parse JSON findings
    -> Proof Test Gen (proof/test-gen.ts)
    -> Fix Gen + Verify (fix/fix-gen.ts)
      -> Diff Gen (diff-gen.ts) -- LCS-based unified diff
    -> Reporter (reporter.ts) -- text/JSON/SARIF
    -> Consensus (consensus.ts) -- multi-model
    -> PR (fix/pr.ts) -- git + gh
    -> Interactive (interactive.ts) -- readline REPL
```

Shared utilities: `util.ts` (pMap, findingKey, cleanLlmResponse), `colors.ts` (ANSI codes), `tui.ts` (Spinner, ProgressBoard).

## Blog Post Angles

### "The tool that reviews its own code"
Brunt found real bugs in itself during a live demo scan. Two were fixed on the spot. That's the trust signal -- it's not just generating opinions, it's finding things that actually need fixing.

### "Zero to PR in one command"
`brunt scan --fix --pr` goes from "here's a diff" to "here's a PR with verified fixes" without human intervention. Each fix is proven correct by a generated test.

### "Proof, not opinions"
Every finding comes with a failing test file. Not "you should consider..." but "here's code that demonstrates the bug." Run the test yourself. If it fails, the bug is real.

### "3 LLMs agree this is a bug"
Consensus mode runs the same analysis on multiple models. When Claude, Llama, and GPT all flag the same line, that's not a hallucination.

### "102KB, zero dependencies"
The entire tool ships as a single 102KB JavaScript file. No node_modules. No native binaries. `npx brunt scan` just works.

## Sample CLI Output For Blog

```
$ brunt scan --fix --provider anthropic

  ___  ___  _ _ _  _ _____
 | _ )| _ \| | | || |_   _|
 | _ \|   /| |_| || | | |
 |___/|_|_\ \___/ |_| |_|
  adversarial AI code review  v0.4.0

+ Parsed 15 files.

  Running 5 vectors via anthropic:

  + correctness    3 findings (42s)
  + security       2 findings (38s)
  + performance    0 findings (35s)
  + resilience     1 finding  (40s)
  + business-logic 0 findings (36s)

+ Generated 6 proof tests.
+ Verified 4 fixes, 2 failed.

brunt -- found 6 issues (45230ms)

[correctness] 3 findings

  HIGH src/utils.ts:23  [FIXED]
  parseInt without radix or NaN handling
  Reproduction: Call parseAge('abc') -- returns NaN instead of throwing
  Test: tests/brunt/src-utils-ts-L23.test.ts

  --- fix diff ---
  -  const age = parseInt(input);
  +  const age = parseInt(input, 10);
  +  if (isNaN(age)) throw new Error('Invalid age');

[security] 2 findings

  CRITICAL src/api/users.ts:34  [FIXED]
  SQL injection in user search endpoint
  Reproduction: curl 'localhost:3000/api/users?q=1' OR 1=1--'
  Test: tests/brunt/src-api-users-ts-L34.test.ts

  --- fix diff ---
  -  const query = `SELECT * FROM users WHERE name = '${input}'`;
  +  const query = `SELECT * FROM users WHERE name = $1`;

────────────────────────────────────────
  1 critical  2 high  2 medium  1 low  |  45230ms
  4 fixed  2 unfixed
────────────────────────────────────────
```

## Timeline

| Date | Version | What |
|------|---------|------|
| 2026-03-23 | v0.1 | Initial build. CLI, 5 vectors, 2 providers, test gen, canary defense. |
| 2026-03-28 | v0.3 | Caching, config files, Ollama, SARIF, pre-push hook, PR comments, 50-point code review. Real-world test on intrebit/backend found 3 real issues. |
| 2026-03-28 | v0.4 | Auto-fix + verify loop, rich TUI, demo mode, interactive triage, streaming, multi-model consensus, fix-and-PR, code quality refactor. 202 tests. Brunt scanning itself found 2 bugs we fixed live. |
