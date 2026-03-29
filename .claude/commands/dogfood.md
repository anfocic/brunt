Build brunt and run it on its own current diff.

1. Run `bun run build`
2. Run `node dist/cli.js scan --vectors correctness,security --no-tests --provider claude-cli --no-cache --fail-on low` with a 5-minute timeout
3. Present the findings. If brunt found real issues in its own code, fix them.
