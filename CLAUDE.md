# Vigil

Adversarial AI code review tool. Scans diffs, finds correctness bugs, generates failing tests as proof.

## Stack
- Bun + TypeScript
- No frontend -- CLI only
- Providers: claude-cli (default), Anthropic API

## Commands
- `bun run src/cli.ts scan` -- run a scan locally
- `bun test` -- run tests
- `bun build --compile --outfile dist/vigil src/cli.ts` -- build binary

## Code Conventions
- No comments unless logic is non-obvious
- No external dependencies unless strictly necessary (prefer Bun built-ins)
- All types in the module they belong to, no shared types barrel file
- Errors: throw with descriptive message, let cli.ts catch and format
- LLM prompts: keep in the module that uses them, not a separate prompts/ dir

## Architecture
- `runner.ts` is the orchestrator -- all flow goes through it
- Providers implement a single `query(prompt: string): Promise<string>` interface
- Vectors implement `analyze(diff, context, provider): Promise<Finding[]>`
- Proof generation is a separate step after vector analysis, not inside vectors

## Testing
- Use `bun:test`
- Test the diff parser and reporter with fixtures, not mocks
- Don't test LLM calls -- those are integration tests run manually
