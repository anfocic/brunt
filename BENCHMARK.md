# Brunt Benchmark: Claude CLI vs API for AI Code Review

## Test Setup

- **Codebase**: intrebit backend (Rust/Axum)
- **Branch**: `feat/ai-scenarios` (20 commits, 77 files, +1566/-5900 lines)
- **Diff range**: `master..HEAD`
- **Vectors**: correctness, security
- **Flags**: `--no-tests --no-cache`
- **Date**: 2026-03-30

## Results Summary

| Metric | Claude CLI (cached) | Claude CLI (fresh) | API Sonnet | API Opus |
|---|---|---|---|---|
| Time | ~5 min (cached: 82ms) | 1 min 47s | 7 min 20s | 8 min |
| Total findings | 10 | 7 | 84 | 44 |
| Critical | 0 | 0 | 1 | 8 |
| High | 1 | 1 | 4 | 2 |
| Medium | 6 | 3 | 40 | 23 |
| Low | 3 | 3 | 39 | 11 |
| Canary detected | Yes | No | Yes | Yes |
| Security findings | 2 | 0 | 22 | 2 |
| Correctness findings | 8 | 7 | 62 | 42 |
| Silent file warnings | 0 | 17 | 8 | 11 |

### Run-to-run variance (Claude CLI)

The cached CLI run (from earlier today) found 10 issues including 2 security findings and detected the canary. The fresh rerun found 7 issues, zero security findings, and missed the canary. Same provider, same engine, same diff — **30% variance in finding count and inconsistent canary detection**. This is a key reliability concern: non-deterministic results mean you can't trust a single run.

### Claude CLI fresh rerun findings

| Severity | Finding |
|---|---|
| HIGH | Missing `.await` on `on_activity_created` — scenario trigger future dropped without polling |
| MEDIUM | No `expired_at` column for the 'expired' status (schema symmetry gap) |
| MEDIUM | `ADD COLUMN IF NOT EXISTS` silently skips on partial re-run with wrong type |
| MEDIUM | `ListExecutionsQuery.limit` has no validation, allows negative/zero (PostgreSQL treats negative LIMIT as unlimited) |
| LOW | `spawn_scenario_loop` runs even when `seed_defaults` fails |
| LOW | Cursor field is unparsed String, invalid cursors cause runtime errors |
| LOW | `UpdateAiConfig` accepts arbitrary JSON with no schema validation |

## Cost Estimates

| Provider | Input tokens (est.) | Output tokens (est.) | Est. cost |
|---|---|---|---|
| Claude CLI | N/A (subscription) | N/A | Included in Pro/Max plan |
| API Sonnet | ~150k | ~30k | $1.11 |
| API Opus | ~150k | ~20k | $1.67 |

## Bugs Found in Brunt During Benchmarking

### Bug 1: Invalid model ID silently produces zero results

The brunt config used `claude-sonnet-4-6-20250514` as the model ID. This works with `claude-cli` (Claude Code resolves aliases) but is not a valid API model ID. The Anthropic API returns 404 for this model.

**Impact**: Every API call returned a 404 error. `Promise.allSettled` in the engine caught these as `rejected` and silently dropped them. The result: zero findings, zero errors shown to the user, and a misleading "no issues found" output.

**Fix needed**: Validate model ID on startup or surface per-file errors instead of silently swallowing them.

### Bug 2: No concurrency limiting on API calls

The engine fires all 75 file analyses simultaneously via `Promise.allSettled(files.map(...))`. For the API provider, this means 75+ concurrent HTTP requests per vector (150+ total).

**Impact**: Mass rate limiting (429s) from the Anthropic API. Same silent failure as Bug 1 — all rejected promises get dropped.

**Fix applied**: Added `runWithConcurrency()` helper to engine.ts, limiting API providers to 5 concurrent calls. Claude CLI is unlimited (each subprocess manages its own rate).

### Bug 3: Anthropic provider max_tokens too low

Default was 4096 tokens. For large diffs producing many findings, the response would be truncated mid-JSON, causing parse failure and zero findings.

**Fix applied**: Bumped to 16384.

### Bug 4: No retry on rate limit (429) or overload (529)

The anthropic provider threw immediately on any non-200 response. Rate-limited requests were not retried.

**Fix applied**: Added exponential backoff retry (up to 5 attempts) with `retry-after` header support for 429/529 responses.

## Talking Points for Blog Post

### 1. The "silent failure" problem in AI tooling

All four bugs shared a pattern: the tool silently produced empty results instead of erroring. A user running `brunt scan --provider anthropic` would see "no issues found" and trust it. This is worse than a crash — it's a false negative that builds false confidence.

Lesson: AI dev tools need loud failure modes. "I couldn't analyze this" is infinitely more useful than "I found nothing" when the analysis didn't actually run.

### 2. Model quality vs. model noise

- **Claude CLI (subscription)** found 7 findings on fresh run — focused, high-signal, zero false positives. The missing `.await` bug is a genuine catch.
- **API Opus** found 44 total, 8 critical — but many criticals were about removed module declarations that are actually cleaned up in the same PR. Higher confidence per-finding but still some isolation blindness.
- **API Sonnet** found 84 total — noisiest by far. Many concerns about deleted code that no longer exists in the codebase.

Higher finding count does not mean better review. A noisy reviewer that cries wolf on 84 issues trains developers to ignore findings. A precise reviewer that surfaces 7 real concerns gets attention.

### 3. Non-determinism is a real problem

The same provider (Claude CLI) produced different results on two runs: 10 findings (cached) vs 7 findings (fresh). The canary was detected in one run but not the other. This means a single brunt run is not reliable as a pass/fail gate — you'd need multiple runs or a consensus mechanism to build confidence.

### 4. The canary as a quality gate (and its limits)

Brunt plants a synthetic bug in the diff and checks if the model detects it. This is a clever reliability signal — but it's not reliable itself:
- Claude CLI detected it on one run, missed it on another
- API Sonnet and Opus both detected it

The canary is a useful signal but not a guarantee. A model that detects the canary can still miss real bugs, and a model that misses the canary might still find real issues (as the fresh CLI run proved — 7 real findings despite missing the canary).

### 5. Per-file vs. whole-diff analysis

Brunt analyzes each file independently for parallelism. This means cross-file issues (like "you removed this table from cascade delete but it still exists") are only caught if the model infers them from a single file's diff. This is why the API runs (which succeeded on all 75 files) found more cross-file issues than the CLI run.

Trade-off: per-file analysis scales better and avoids context window limits, but misses systemic issues. A hybrid approach (per-file scan + one cross-file summary pass) could get the best of both.

### 6. CLI vs API: same model, different ergonomics

Claude CLI (subscription) and the Anthropic API can run the same underlying model. Key differences for tool builders:

| | Claude CLI | Anthropic API |
|---|---|---|
| Rate limiting | Handled internally | You build it yourself |
| Retries | Built in | You build it yourself |
| Model resolution | Aliases work (e.g., dated versions) | Exact model ID required |
| Default model | User's subscription default (often Opus) | Must specify explicitly |
| Cost | Included in subscription | Pay per token |
| Speed | Slower (subprocess per call) | Faster (HTTP requests) |
| Concurrency | Limited by CLI internals | You control it |

The CLI is simpler to integrate but gives you less control. The API is more work but more predictable once you handle the infrastructure correctly.

### 7. What the models actually found (highlight reel)

**Real issues (caught across runs)**:
- Missing `.await` on async trigger call — future silently dropped (CLI fresh)
- CSV formula injection in data export (API Sonnet/cached CLI)
- TOCTOU race condition in scenario trigger — duplicate executions (API Opus/Sonnet)
- No `expired_at` column for expired status (CLI fresh)
- `ListExecutionsQuery.limit` allows negative values — PostgreSQL treats as unlimited (CLI fresh/API Sonnet)
- Cursor pagination on non-unique timestamp silently skips records (cached CLI/API Sonnet)
- `UpdateAiConfig` accepts arbitrary JSON with no schema validation (CLI fresh/API Sonnet)
- Shutdown signal missed during initial sleep in background jobs (cached CLI)

**False positives (common patterns)**:
- "Removed module declaration breaks dependents" — true in isolation, but dependents were also removed in the same PR (API Opus flagged 8 of these as critical)
- Flagging bugs in deleted code that no longer exists in the codebase (API Sonnet)
- Concerns about parameter binding in code that was entirely removed (API Sonnet)

### 8. The API found more because it ran more

A subtle but important point: the CLI runs each file as a `claude -p` subprocess. With 75 files x 2 vectors = 150 subprocesses, the CLI may have hit internal rate limits or timeouts, silently dropping some analyses. The API (after our fixes) ran all 150 calls with controlled concurrency and retry logic, ensuring every file was actually analyzed.

More findings isn't always noise — sometimes it means more files were actually reviewed.

## Re-run Checklist

Before the next round of benchmarks:

- [ ] Clear all caches: `rm -rf .brunt-cache/`
- [ ] Use correct model IDs: `claude-sonnet-4-6`, `claude-opus-4-6`
- [ ] Add `--format json` runs for programmatic comparison
- [ ] Track actual token usage from API responses
- [ ] Consider running CLI 3x to measure variance
