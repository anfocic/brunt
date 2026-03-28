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
- [x] Vector error isolation (Promise.allSettled -- one vector failure doesn't kill the scan)
- [x] 117 tests

## v0.3
- [ ] `brunt init` — set up git pre-push hook
- [ ] Daemon/watch mode (`brunt watch`)
- [ ] PR comment integration (post findings inline on GitHub PRs)
- [ ] Caching (same diff = same findings, skip re-scan)
- [ ] Custom vector plugins (load from brunt.config.yaml)
- [ ] Vector-specific context hints (e.g., "this is a billing system" for business-logic)

## v1.0
- [ ] Compiled binaries (GitHub Releases, zero runtime dependency)
- [ ] Vector marketplace / community registry
- [ ] VS Code extension (inline findings as diagnostics)
- [ ] Monorepo support (scan only changed packages)
- [ ] Baseline / ignore file (suppress known findings)
- [ ] Metrics dashboard (findings over time)
