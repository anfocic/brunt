# Brunt

Adversarial AI code review tool. Scans diffs, finds bugs, generates failing tests as proof.

## Stack
- Develop with Bun + TypeScript
- Build to Node-compatible JS for distribution
- No frontend -- CLI only
- Providers: claude-cli (default), Anthropic API

## Commands
- `bun run src/cli.ts scan` -- run a scan locally (dev)
- `bun run build` -- build for Node (`dist/cli.js`)
- `node dist/cli.js scan` -- run built output
- `bun test` -- run tests

## Code Conventions
- No comments unless logic is non-obvious
- Use Node APIs (fs, child_process) not Bun APIs -- output must run on Node 18+
- All types in the module they belong to, no shared types barrel file
- Errors: throw with descriptive message, let cli.ts catch and format
- LLM prompts: keep in the module that uses them, not a separate prompts/ dir

## Architecture
- `runner.ts` is the orchestrator -- all flow goes through it
- Providers implement a single `query(prompt: string): Promise<string>` interface
- Vectors implement `analyze(diff, context, provider): Promise<Finding[]>`
- Proof generation is a separate step after vector analysis, not inside vectors
- `parse.ts` shared LLM response parser with type validation and error warnings

## Testing
- Use `bun:test` for development
- Test the diff parser and reporter with fixtures, not mocks
- Don't test LLM calls -- those are integration tests run manually
