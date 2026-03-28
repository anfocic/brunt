# Brunt Worklog

## 2026-03-28 — v0.2 release (modular + configurable)

### What was done
- Config file system (brunt.config.yaml) with minimal YAML parser, no deps
- Ollama provider for free local models (HTTP API, 5min timeout, env var support)
- --max-tokens and --model CLI flags, ProviderOptions threaded to all providers
- Sensitive file filtering (.env, secrets, credentials, keys -- on by default)
- SARIF 2.1.0 output format for GitHub Security tab / VS Code
- Parallel test generation via pMap (concurrency-limited, default 3)
- Two-pass canary validation (LLM verifies canary detection after string match)
- Self-review fixes: vector error isolation (Promise.allSettled), regex escaping in sensitive patterns, config value validation, concurrency bounds

### Stats
- 117 tests, 0 failures, 48KB bundle
- 3 new files, 12 modified files
- Zero runtime dependencies maintained

### What's next
- See ROADMAP.md for v0.3 features
- Remaining review items (low/medium): SARIF stable rule IDs, sanitize.ts string-aware comment stripping

## 2026-03-23 — Initial build (v0.1)

### What was done
- Full v0.1 built from scratch in one session
- Core: CLI, diff parser, context loader, runner, reporter
- 2 providers: claude-cli (free with Max plan), anthropic (API)
- 5 vectors: correctness, security, performance, resilience, business-logic
- Modular architecture inspired by Intrebit Probe pattern
- Prompt injection defense: canary injection + comment stripping
- Proof test generation with framework auto-detection
- GitHub Action (action/action.yml)
- 3 code review rounds — all findings fixed
- Node 18+ compatible (builds via bun build --target node)

### Stats
- 10 commits, 61 tests, 33KB bundle, tsc clean
- npm name `brunt` is available

### What's next
- Publish to npm and GitHub
- See ROADMAP.md for v0.2+ features
