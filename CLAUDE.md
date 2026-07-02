# brunt — project guide

Adversarial AI code review. Scans a git diff across "vectors" (correctness, security,
custom), generates a failing proof test per finding, optionally auto-fixes and opens a PR.
CLI + GitHub Action. Published as `@fole/brunt`. Repo: https://github.com/anfocic/brunt

Pre-1.0, effectively no external users yet — breaking changes are cheap. Owner: fole (anfocic).

## Why we're working on it
brunt is the code-reviewer half of a planned **brunt + ctx demo**: ctx (https://ctx.rs,
a local index over past coding-agent sessions) would feed prior decisions / reverted fixes
into brunt's review so brunt can flag *regressions* ("this diff reintroduces a bug fixed in
session X"). That integration is scoped to brunt's **local CLI path only** (ctx has nothing
to index on a CI runner). Not built yet — see WORKLOG "Next". Reliability + config had to
land first because the demo runs brunt against a real project.

## Stack & commands
- TypeScript, ESM, Node >=18. npm workspaces: root + `packages/llm` + `packages/devkit`.
- Build: `npm run build` (builds packages then `tsc`). Bundle for publish: `npm run bundle`.
- Test: `npm test` (builds, then `node --test dist/tests/**/*.test.js`). No lint script.
- Run locally: `node dist/cli.js scan --diff <range> [flags]` (after a build).

## Gotchas
- **Default provider is `claude-cli`** (the Claude Code CLI binary). `checkProvider` runs
  *before* the diff is read, so on a machine without `claude` installed and no API key,
  even `scan` on an empty diff exits 2. The 5 `runner.test.ts` integration tests spawn the
  real CLI and therefore FAIL locally unless `claude` is on PATH — this is environmental,
  not a code regression. The other ~300 tests are hermetic. To check your work, run:
  `node --test $(ls dist/tests/*.test.js | grep -v runner.test.js)`.
- **`--fix` and `--verify` mutate the working tree.** They swap source files on disk
  (base-branch verification) and leave verified fixes applied. Crash-recovery is handled by
  a `.brunt-restore` manifest + `src/restore.ts` `RestoreGuard`; on startup `run()` calls
  `restoreFromManifest()`. When touching that path, keep the manifest cumulative (many files
  at once) — see the regression tests in `src/tests/restore.test.ts`.
- Providers live in `packages/llm/src/*` (anthropic, openai, ollama, claude-cli). Findings
  are parsed from LLM JSON in `src/vectors/parse.ts` (strict: drops entries missing fields).

## Architecture (src/)
- `cli.ts` — arg parsing + config precedence (CLI flag > `brunt.config.yaml` > default). `run`/`runBaseline`/`runAudit` dispatch.
- `runner.ts` — orchestrates a scan: diff → scope → engine → baseline → tests → fixes → report.
- `engine.ts` — batches files, runs each vector, canary + injection + suspicious-silence checks.
- `diff.ts` — git diff parsing, language inference, sensitive-file exclusion.
- `context.ts` / `crossref.ts` — supplementary context fed to vectors (windowed file content; symbol cross-references). **ctx integration slots in here as a sibling to crossref.**
- `vectors/` — `factory.ts` builds a vector from a prompt; `correctness`/`security` built-ins; `parse.ts` validates findings.
- `proof/test-gen.ts` — generates + runs proof tests; base-branch verification.
- `fix/fix-gen.ts` + `fix/pr.ts` — LLM fixes with mutation check; branch/commit/PR via `gh`.
- `restore.ts` — crash-safe working-tree swap tracking (shared by test-gen + fix-gen).
- `config.ts` — `brunt.config.yaml` loader (settings + vectors).

## Config schema (brunt.config.yaml)
Entirely optional — brunt runs standalone with no config file at all (built-in defaults).
When present, it's auto-detected in cwd (or `--config <path>`) and every key is optional;
CLI flags override config.
```yaml
provider: anthropic          # claude-cli | anthropic | ollama | openai
model: claude-...            # non-empty string
format: text                 # text | json | sarif
failOn: medium               # low | medium | high | critical
scope: backend               # monorepo subpath
maxTokens: 8000              # 1..1_000_000
fixRetries: 2                # 1..5
fix: false                   # booleans below can only turn a flag ON
verify: false
noTests: false
noCache: false
vectors:                     # the exact set to run, in order
  - correctness              #   built-in name (string), or…
  - name: billing            #   custom vector (object)
    description: "..."
    prompt: "..."
```
Listing a name that is neither a built-in nor a defined custom vector fails with
`Unknown vector: "<name>". Available: ...`. Note `resilience`, `performance`, and
`business-logic` were built-in vectors in v0.1 and have since been removed — only
`correctness` and `security` are built in now.

## Known remaining bugs (backlog — not yet fixed)
Ranked from the 2026-07-02 review. Fixed this session: base-branch data-loss, `--fix`
crash-safety, and the config schema gap.
| Sev | Where | Issue |
|---|---|---|
| Med | `proof/test-gen.ts` `verifyTests` | Any non-zero exit = "bug confirmed"; a test that fails to compile counts as a real bug. |
| Med | `packages/llm/src/openai.ts` | Default `max_tokens` 4096 (vs 16384 anthropic) → findings JSON truncated → silently dropped in `parse.ts`. |
| Med | `test-gen.ts` vs `fix/fix-gen.ts` | Two different test-runner detectors; fix-gen prefers `bun test` regardless of project framework. |
| Med | `test-gen.ts` (rust) | `cargo test` runs the whole suite, not the one proof test → wrong verdicts. |
| Low | `packages/llm/src/anthropic.ts` | Default model `claude-sonnet-4-6` — verify it's a real API id (CRM used `claude-sonnet-4-6-20250514`). |
| Low | `cache.ts` | Cache key omits context/crossrefs; no TTL/eviction (`.brunt-cache` grows unbounded). |
| Low | `util.ts` + `test-gen.ts` | `exec` collapses all exit codes to 1; default 1MB maxBuffer for `git show` → files >1MB look "not in base". |
| Low | `sanitize.ts` | Block comments stripped per-line, not across lines → multi-line comment injection partly survives. |
| UX | `runner.ts` | `checkProvider` runs before the empty-diff short-circuit; empty diff still needs a working provider. |

## Lessons
- Match the surrounding style; no comments unless the "why" is non-obvious.
- Working-tree mutation is the scariest surface here — always keep crash recovery intact and covered by tests.
