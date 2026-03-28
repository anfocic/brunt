# Brunt v0.4 Test Plan

Run these tests with a fresh ANTHROPIC_API_KEY to capture real numbers for the blog post.

## Prerequisites

```bash
export ANTHROPIC_API_KEY=sk-ant-...
cd ~/Desktop/apps/brunt
bun run build
```

Verify the key works:
```bash
curl -s https://api.anthropic.com/v1/models \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" | jq '.data[0].id'
```

Check rate limits -- free tier is 30k input tokens/min. Space tests ~90s apart or use a paid key.

## Test 1: Basic Scan (capture baseline numbers)

Brunt scanning itself. Single vector to stay within rate limits.

```bash
bun run src/cli.ts scan \
  --provider anthropic \
  --diff HEAD~3 \
  --no-cache \
  --vectors correctness \
  --no-tests \
  --fail-on critical
```

Capture: finding count, duration, any errors.

## Test 2: Multi-Vector Scan

All 5 vectors. Will use more tokens -- may need paid key or sequential runs.

```bash
bun run src/cli.ts scan \
  --provider anthropic \
  --diff HEAD~3 \
  --no-cache \
  --no-tests \
  --fail-on critical
```

If rate limited, run vectors one at a time:
```bash
for v in correctness security performance resilience business-logic; do
  echo "=== $v ==="
  bun run src/cli.ts scan --provider anthropic --diff HEAD~3 --no-cache --vectors $v --no-tests --fail-on critical
  sleep 90
done
```

Capture: per-vector finding counts, per-vector duration, total duration.

## Test 3: Scan + Proof Tests

Generate failing tests for findings.

```bash
bun run src/cli.ts scan \
  --provider anthropic \
  --diff HEAD~3 \
  --no-cache \
  --vectors correctness,security \
  --fail-on critical
```

Capture: number of tests generated, test file paths, whether they actually fail when run.

After scan, try running a generated test:
```bash
bun test tests/brunt/  # run all generated tests
```

## Test 4: Scan + Fix + Verify (The Full Loop)

The showcase moment. Find -> prove -> fix -> verify.

```bash
bun run src/cli.ts scan \
  --provider anthropic \
  --diff HEAD~3 \
  --no-cache \
  --vectors correctness \
  --fix \
  --fix-retries 2 \
  --fail-on critical
```

Capture: findings count, tests generated, fixes attempted, fixes verified, fix diffs shown, total duration.

Check that verified fixes actually changed the files:
```bash
git diff  # should show the applied fixes
git checkout -- .  # rollback after capturing output
```

## Test 5: Demo Mode

Zero-setup showcase. Creates temp repo with known-buggy file.

```bash
bun run src/cli.ts demo --provider anthropic
```

Capture: full terminal output (screenshot this). Should show:
- Banner
- 3 findings (off-by-one, SQL injection, negative refund)
- 3 proof tests generated
- Fix attempts and results
- Summary dashboard

## Test 6: JSON Output

Machine-readable output for the blog.

```bash
bun run src/cli.ts scan \
  --provider anthropic \
  --diff HEAD~3 \
  --no-cache \
  --vectors correctness \
  --no-tests \
  --format json \
  --fail-on critical 2>/dev/null | jq .
```

Capture: the JSON structure. Shows finding schema, duration, vector breakdown.

## Test 7: Streaming Preview

Run with TTY to see the live token preview during analysis.

```bash
bun run src/cli.ts scan \
  --provider anthropic \
  --diff HEAD~1 \
  --no-cache \
  --vectors security \
  --no-tests \
  --fail-on critical
```

Capture: screen recording or screenshot showing the streaming preview text during vector execution.

## Test 8: Built Distribution

Verify the npm-published form works.

```bash
node dist/cli.js scan \
  --provider anthropic \
  --diff HEAD~1 \
  --no-cache \
  --vectors correctness \
  --no-tests \
  --fail-on critical
```

Capture: same output as dev, confirming the 103KB bundle works standalone.

## Numbers to Collect

| Metric | Where to get it |
|--------|----------------|
| Time per vector | Shown in output (e.g., "correctness: 8 findings (42s)") |
| Total scan time | Shown in summary ("brunt -- found N issues (Xms)") |
| Findings per vector | Shown in output |
| Tests generated | Shown in progress ("Generated N proof tests") |
| Fixes verified | Shown in progress ("Verified N fixes") |
| Bundle size | `ls -lh dist/cli.js` |
| Test count | `bun test` output |
| Source lines | `wc -l src/**/*.ts src/*.ts` |
| API cost estimate | Check Anthropic dashboard after all tests |

## Rate Limit Strategy

The free tier is 30k input tokens/min. Each vector call with a 15-file diff uses ~10-20k tokens. Options:

1. **Sequential with waits**: Run one vector at a time, 90s between each
2. **Paid key**: No practical limit for this volume
3. **Smaller diffs**: `--diff HEAD~1` instead of `HEAD~3` reduces token usage

## Screenshots to Take

1. Banner + progress board during scan (streaming preview visible)
2. Full output with [FIXED] badges and inline diffs
3. Summary dashboard (the box-drawing severity breakdown)
4. Demo mode full output
5. JSON output piped through jq
6. `brunt help` showing all commands and flags
