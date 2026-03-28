# Brunt Worklog

## 2026-03-28 — v0.4 AI showcase

### What was done

**Phase 1: Auto-Fix + Rich TUI**
- Auto-fix engine: generate fix via LLM, apply, run proof test, verify/rollback, retry
- LCS-based unified diff generator (src/diff-gen.ts) for showing fix diffs
- Path validation to prevent LLM-directed path traversal
- Per-file grouping to prevent race conditions on concurrent fixes
- TUI: Spinner, ProgressBoard (multi-line in-place updates), ASCII banner
- TTY detection with CI-safe fallback (plain text)
- Summary dashboard with severity breakdown and fix counts
- Inline diff display (green/red) for verified fixes
- [FIXED] / [FIX FAILED] badges per finding in text and JSON output

**Phase 2: Demo + Interactive**
- `brunt demo` -- embedded buggy file (off-by-one, SQL injection, negative refund), temp git repo, full pipeline
- `brunt scan --interactive` -- REPL with explain/fix/accept/dismiss/quit, async processing lock

**Phase 3: Streaming + Consensus + PR**
- `queryStream()` on all 3 providers (Anthropic SSE, Ollama line-delimited JSON, Claude CLI spawn)
- Streaming wired into vector factory -- live token preview on stderr during analysis
- Multi-model consensus engine with fuzzy finding matching (Jaccard + line proximity)
- `--consensus` and `--consensus-providers` flags
- Consensus report formatter with [N/M models] badges
- `brunt scan --fix --pr` -- creates branch, commits verified fixes, opens PR via gh CLI
- Detached HEAD detection, base branch restoration, markdown sanitization in PR body

**Code Quality Refactor**
- Extracted src/colors.ts (ANSI codes were in 3 files)
- Extracted src/util.ts (pMap, findingKey, cleanLlmResponse)
- Extracted src/diff-gen.ts (generateDiff + computeLcs out of fix-gen)
- Merged cleanFixOutput + cleanLlmOutput into shared cleanLlmResponse
- Deleted dead code: duplicate LCS computation, unused dp variable, identical ternaries
- Extracted runConsensus() from run(), hoisted redundant sanitize/context calls
- Fixed Ollama timeout (wasn't respecting options.timeout)
- Fixed err:any to err:unknown across providers
- Fixed formatJson using raw string instead of findingKey() (found by brunt scanning itself)
- Fixed createFixPr receiving unfiltered fixes array (found by brunt scanning itself)

**Self-Review (3 rounds)**
- Phase 1: caught 4 critical bugs (race condition, path traversal, wrong output cleaner, broken diff)
- Phase 2+3: caught 24 issues (4 critical, 5 high, 9 medium, 6 low)
- Code quality: caught 24 structural issues, fixed top 9
- Set up PreToolUse hook to enforce self-review on large commits

**Live API Test**
- Brunt scanned itself via Anthropic API (claude-sonnet-4-6)
- 8 findings in 57 seconds on 13 files
- Found 2 real bugs in its own code, fixed on the spot
- Default model updated from date-suffixed to `claude-sonnet-4-6`

### Stats
- 202 tests, 0 failures, 103KB bundle, zero runtime deps
- 22 source files, ~3,200 lines
- Branch: feat/v0.4-ai-showcase (not yet committed/pushed)
- New CLI flags: --fix, --fix-retries, --interactive, --pr, --consensus, --consensus-providers
- New commands: brunt demo

### What's next
- Commit and push feat/v0.4-ai-showcase
- Run TESTPLAN.md with fresh API key for blog post numbers
- Write blog post using SHOWCASE.md material
- Merge to master, publish to npm
- See ROADMAP.md for v1.0 features

## 2026-03-28 — v0.3 release + real-world testing

### What was done

**v0.2 (feat/v0.2-modular-config, merged to v0.3 branch):**
- Config file system (brunt.config.yaml) with zero-dep YAML parser
- Ollama provider for free local models
- --max-tokens, --model CLI flags, ProviderOptions on all providers
- Sensitive file filtering (.env, secrets, keys -- on by default)
- SARIF 2.1.0 output format
- Parallel test generation via pMap
- Two-pass canary validation
- Vector error isolation (Promise.allSettled)

**v0.3 (feat/v0.3-ci-polish):**
- Scan caching (same diff = skip LLM, --no-cache to force)
- `brunt init` -- git pre-push hook
- `--pr-comment` -- inline GitHub PR review comments
- Bug fixes from 50-point code review:
  - Stable SARIF rule IDs (content hash)
  - String-aware comment stripping (URLs preserved)
  - String-aware block comment stripping
  - JSON parser tracks string state for brackets
  - Context lines now sanitized (closed prompt injection vector)
  - DOMException compat for Node 18
  - SSRF validation on GitHub env vars
  - Unknown CLI flags throw instead of silent ignore
  - Vector factory eliminates 5-file copy-paste
- UX improvements:
  - Auto-detect CI diff range from GITHUB_BASE_REF
  - Per-vector progress output during scans
  - Pre-push hook respects brunt.config.yaml
  - Provider timeouts bumped to 5min (was 2min, too short for real diffs)
- README rewritten for all v0.2/v0.3 features
- GitHub Action updated (SARIF upload, --pr-comment, --model, --format)

**Real-world testing on intrebit/backend:**
- Scanned commit 470f01e (32 files, security vector, 83s)
- Found 3 real issues: TOCTOU booking race, GDPR export auth bypass, SMTP config leak
- Issues logged in ~/Desktop/intrebit/backend/BRUNT_ISSUES.md
- GitLab CI review stage added to .gitlab-ci.yml (not yet pushed)

### Stats
- 158 tests, 0 failures, 58KB bundle, zero runtime deps
- Branch: feat/v0.3-ci-polish (6 commits, pushed to origin)
- v0.2 branch also pushed (feat/v0.2-modular-config)

### What's next
- User will push intrebit CI changes and add ANTHROPIC_API_KEY to GitLab
- User will fix the 3 intrebit findings and re-run brunt to verify
- Merge v0.3 PR on GitHub
- Publish to npm
- See ROADMAP.md for v1.0 features

## 2026-03-23 — Initial build (v0.1)

### What was done
- Full v0.1 built from scratch in one session
- Core: CLI, diff parser, context loader, runner, reporter
- 2 providers: claude-cli, anthropic
- 5 vectors: correctness, security, performance, resilience, business-logic
- Prompt injection defense: canary injection + comment stripping
- Proof test generation with framework auto-detection
- GitHub Action
- Node 18+ compatible

### Stats
- 10 commits, 61 tests, 33KB bundle, tsc clean
- npm name `brunt` is available
