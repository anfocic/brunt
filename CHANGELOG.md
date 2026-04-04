# Changelog

All notable changes to this project will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.0] - 2026-04-04

### Added
- **Base-branch verification**: after a proof test confirms a bug, brunt runs the test against the base branch. If it fails there too, the finding is pre-existing or a false positive and gets dropped. Includes `.brunt-restore` crash recovery manifest for interrupted file swaps.
- **Fix minimality guard**: rejects generated fixes that change more than `max(10, 50% of source lines)`. Oversized fixes are retried with feedback within the existing attempt loop.
- **Mutation check**: after a fix passes the test, brunt reverts to the original buggy code and reruns the test. If the test still passes, it isn't testing the right thing — the fix is rejected and retried.
- **Monorepo support**: `--scope <path>` filters scanned files to a specific package (e.g. `--scope packages/auth`). Auto-detects when all changed files share a common monorepo package prefix (`packages/`, `apps/`, `services/`, `libs/`, `modules/`). Use `--scope .` to scan everything.
- **Custom vector plugins**: define custom analysis vectors in `brunt.config.yaml` with a name, description, and prompt. Vectors are loaded through the existing `createVector()` factory and merged with built-in vectors. Use `--config <path>` for explicit config location. See `brunt.config.example.yaml` for examples.

### Changed
- Proof loop now has 5 deterministic gates (was 2): test-fail, base-branch, minimality, test-pass-after-fix, mutation-revert
- `yaml` added as the only runtime dependency (for config parsing)

## [0.5.0] - 2026-04-04

### Added
- **Baseline suppression**: `brunt baseline` saves current findings to `.brunt-baseline.json`. Future scans automatically filter them out. Use `--no-baseline` to see all findings, `--baseline-path` for a custom location. Suppressed count shown in text, JSON, and SARIF output.
- **OpenAI-compatible providers**: `--provider openai` now works with any server that speaks the OpenAI chat completions protocol. Set `OPENAI_BASE_URL` to point at LM Studio, llama.cpp, vLLM, LocalAI, Together, Groq, or any other compatible server. API key is optional for local servers.

### Fixed
- **Anthropic**: removed unreachable code after retry loop, fixed double `clearTimeout` in `queryRich`
- **OpenAI**: added retry with exponential backoff on 429 rate limits (was failing immediately), aligned default timeout from 60s to 300s
- **Ollama**: switched from `/api/generate` to `/api/chat` with proper system/user message roles (was naively concatenating system prompt with `\n\n`)
- **Claude CLI**: `queryStream` now detects missing `claude` binary (ENOENT) instead of silently returning empty, and throws timeout error when process is killed
- **Cost tracking**: added explicit Sonnet pricing entry (was falling through to default)
- **CLI**: added `openai` to valid providers list (was rejected despite backend support)

### Changed
- **Token optimization — system/user split**: vector instructions and response format now sent as system message via `queryRich()`, enabling Anthropic prompt caching. After the first file per vector, remaining files hit the cache.
- **Token optimization — context windowing**: large files (>200 lines) now send only ±50 lines around each changed hunk plus the first 10 lines (imports/types), instead of the full file (up to 50KB). Skipped regions shown as `... (N lines omitted) ...`.
- **Token optimization — file batching**: small files are grouped into batches (~4000 token budget each) to reduce API call count. A 10-file diff typically goes from 10 calls to 3-4 per vector.
- **Diff parser**: now extracts hunk start line numbers from `@@` headers (previously discarded) to support context windowing.
- Test count: 223 → 230

## [0.4.0] - 2026-03-28

### Added
- **Auto-fix engine**: generate fix via LLM, apply, run proof test, verify or rollback, retry (`--fix`, `--fix-retries`)
- **Demo mode**: `brunt demo` runs a full scan against a built-in buggy file (off-by-one, SQL injection, negative refund)
- **Interactive triage**: `brunt scan --interactive` opens a REPL to explain, fix, accept, or dismiss findings
- **Streaming**: `queryStream()` on all 3 providers for real-time LLM output during analysis
- **Multi-model consensus**: `--consensus` runs the same scan across multiple providers and shows agreement
- **PR creation**: `--fix --pr` creates a branch, commits verified fixes, and opens a PR via `gh`
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
