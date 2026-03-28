# Brunt Worklog

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
