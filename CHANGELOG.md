# Changelog

All notable changes to this project will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] - 2026-03-28

### Added
- **Auto-fix engine**: generate fix via LLM, apply, run proof test, verify or rollback, retry (`--fix`, `--fix-retries`)
- **Demo mode**: `brunt demo` runs a full scan against a built-in buggy file (off-by-one, SQL injection, negative refund)
- **Interactive triage**: `brunt scan --interactive` opens a REPL to explain, fix, accept, or dismiss findings
- **Streaming**: `queryStream()` on all 3 providers for real-time LLM output during analysis
- **Multi-model consensus**: `--consensus` runs the same scan across multiple providers and shows agreement
- **PR creation**: `--fix --pr` creates a branch, commits verified fixes, and opens a PR via `gh`
- **Baseline management**: `brunt baseline init|update|show|clear` to suppress known/accepted findings
- **Rich TUI**: spinner, multi-line progress board, ASCII banner, severity-colored output
- **CI dogfood job**: brunt scans itself on every PR

### Changed
- Bundle size: 58KB -> 109KB (new features)
- Test count: 158 -> 223
- Vector factory eliminates per-vector boilerplate
- Extracted shared utilities (colors, pMap, findingKey, cleanLlmResponse)

## [0.3.0] - 2026-03-28

### Added
- **Scan caching**: same diff + vectors + provider = instant results (`--no-cache` to force)
- **Git hook**: `brunt init` installs a pre-push hook
- **PR comments**: `--pr-comment` posts findings as inline GitHub PR review comments
- **SARIF output**: `--format sarif` for GitHub Code Scanning integration

### Fixed
- Stable SARIF rule IDs (content hash instead of index)
- String-aware comment stripping (URLs no longer mangled)
- JSON parser tracks string state for bracket matching
- Context lines now sanitized (closed prompt injection vector)
- DOMException compatibility for Node 18
- SSRF validation on GitHub environment variables
- Unknown CLI flags now throw instead of silent ignore
- Provider timeouts bumped to 5 minutes (was 2, too short for real diffs)

## [0.2.0] - 2026-03-28

### Added
- **Config file**: `brunt.config.yaml` with zero-dep YAML parser
- **Ollama provider**: free local models via `--provider ollama`
- **Sensitive file filtering**: `.env`, secrets, keys excluded by default
- `--max-tokens`, `--model` CLI flags
- Parallel test generation
- Two-pass canary validation
- Vector error isolation via `Promise.allSettled`

## [0.1.0] - 2026-03-23

### Added
- Core CLI with 5 analysis vectors (correctness, security, performance, resilience, business-logic)
- 2 providers: claude-cli, anthropic
- Diff parser with hunk extraction
- Proof test generation with framework auto-detection
- Prompt injection defense (canary injection + comment stripping)
- GitHub Action for CI integration
- Text and JSON output formats
- Node 18+ compatible, zero runtime dependencies
