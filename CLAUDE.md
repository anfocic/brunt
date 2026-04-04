# CLAUDE.md

## Commands

```bash
npm run build                    # Build packages + tsc
npm run bundle                   # Single-file ESM CLI → dist/cli.js
npm run test                     # Build + run all tests
node --test dist/tests/*.test.js # Run tests (after build)
```

## What This Is

Brunt is an adversarial AI code review CLI. It scans git diffs for bugs using LLM-powered "vectors" (correctness, security, custom), generates failing tests as proof, and optionally auto-fixes them.

## Architecture

```
src/
├── cli.ts          # Arg parsing, entry point
├── runner.ts       # Orchestrates: diff → engine → report
├── engine.ts       # Core scan loop: batching, caching, canary injection
├── diff.ts         # Git diff parsing → DiffFile[]
├── config.ts       # brunt.config.yaml loading
├── monorepo.ts     # Package boundary detection for --scope
├── vectors/        # Analysis modules (each wraps an LLM prompt)
│   ├── factory.ts  # createVector() — the core abstraction
│   ├── custom.ts   # User-defined vectors from config
│   └── types.ts    # Finding, Vector, VectorReport types
├── proof/          # Test generation to prove findings
├── fix/            # Auto-fix generation + PR creation
└── tests/          # 260+ tests, node:test + assert/strict
packages/
├── llm/            # Provider abstraction (anthropic, openai, ollama, claude-cli)
└── devkit/         # Terminal colors, templates, utilities
```

**Data flow:** `git diff` → `DiffFile[]` → `sanitize` → `canary inject` → `batch` → `LLM (per vector)` → `parseFindings` → `proof tests` → `report`

## Things That Will Bite You

- The `packages/llm` build has pre-existing type errors that don't block the build. Don't try to fix them.
- 8 tests in diff/runner suites are pre-existing failures (git repo setup issues in test env). Your changes should not add new failures.
- `createVector(name, description, promptBody)` in `factory.ts` is the core abstraction. Custom vectors, correctness, and security all use it. The factory injects diff/context/crossref sections automatically — vector prompts only define the system behavior.
- Cache keys hash (files + vectors + provider). Changing a vector's prompt without changing its name can serve stale cache.
- Comment stripping (`sanitize.ts`) removes comments before the LLM sees code — this is a security feature against prompt injection, not a bug.

## Code Conventions

- TypeScript strict mode, ES2022 target, ESM throughout
- Zero runtime deps except `yaml` for config parsing
- Tests use `node:test` + `node:assert/strict` (not Jest/Vitest)
- Test files mirror source: `src/foo.ts` → `src/tests/foo.test.ts`
- Temp git repos in tests via `mkdtempSync` + `spawnSync("git", ["init"])`
- No default exports. Named exports only.
- Monorepo workspaces: `packages/llm`, `packages/devkit`

## Before You Commit

1. `npm run build` must pass (tsc clean)
2. New tests for new functionality
3. Don't break existing 255 passing tests
