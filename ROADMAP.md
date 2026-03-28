# Brunt Roadmap

## v0.1 (done)
- [x] CLI with scan, list, help commands
- [x] Diff parser with language detection and file filtering
- [x] 5 vectors: correctness, security, performance, resilience, business-logic
- [x] 2 providers: claude-cli, anthropic
- [x] Proof test generation with framework auto-detection
- [x] Prompt injection defense (canary + comment stripping)
- [x] JSON + text output formats
- [x] GitHub Action
- [x] Node 18+ compatible
- [x] 61 tests, tsc clean

## v0.2 (done)
- [x] Ollama provider (free local models)
- [x] Config file (brunt.config.yaml) for project-level defaults
- [x] SARIF output format (GitHub Security tab, VS Code, SonarQube)
- [x] Parallel test generation (concurrency-limited pMap)
- [x] Token budget cap (--max-tokens flag)
- [x] Sensitive file filtering (.env, *secret*, *credential* excluded from diff)
- [x] Two-pass canary validation (second LLM call to verify)
- [x] --model flag for provider model selection
- [x] Config validation (provider, format, severity, concurrency bounds)
- [x] Vector error isolation (Promise.allSettled)
- [x] 117 tests

## v0.3 (done)
- [x] Stable SARIF rule IDs (content hash instead of array index)
- [x] String-aware comment stripping (no longer mangles URLs in strings)
- [x] Scan caching (same diff = same findings, skip LLM calls)
- [x] `brunt init` — install git pre-push hook
- [x] PR comment integration (`--pr-comment` posts findings inline on GitHub PRs)
- [x] --no-cache flag to force fresh analysis
- [x] 140 tests

## v1.0
- [ ] Compiled binaries (GitHub Releases, zero runtime dependency)
- [ ] Vector marketplace / community registry
- [ ] VS Code extension (inline findings as diagnostics)
- [ ] Monorepo support (scan only changed packages)
- [ ] Baseline / ignore file (suppress known findings)
- [ ] Metrics dashboard (findings over time)
- [ ] Custom vector plugins (load from brunt.config.yaml)
- [ ] Daemon/watch mode (`brunt watch`)
- [ ] Vector-specific context hints (e.g., "this is a billing system")
