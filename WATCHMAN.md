# Watchman Plan — Deterministic Verification for the Proof Loop

## Problem

The proof loop is self-referential: LLM finds bug → LLM writes test → LLM writes fix → LLM's test verifies LLM's fix. Every step is probabilistic. The LLM can hallucinate a bug, write a test that fails for the wrong reason, and a fix that passes the broken test.

## Three Deterministic Checks

### Check 1: Base-Branch Verification (PRIMARY)

**Status:** Planned, not yet implemented

**Concept:** After confirming a test fails on new code, run it against the base branch version of the file. If it fails there too, the bug is pre-existing or the test is wrong — drop the finding.

**Implementation:**

1. **`resolveBaseRef(range: string): Promise<string>`** in `src/diff.ts`
   - Parse diff range to extract base commit
   - `HEAD~1` → `HEAD~1`, `origin/main..HEAD` → `origin/main`, `--cached` → `HEAD`
   - Resolve to SHA via `git rev-parse`

2. **`getBaseFileContent(baseRef: string, filePath: string): Promise<string | null>`** in `src/proof/test-gen.ts`
   - Uses `git show <baseRef>:<filePath>` to read the old version
   - Returns null if file didn't exist (new file → skip check)

3. **`verifyTestsAgainstBase(tests, baseRef, concurrency?): Promise<VerifyResult[]>`** in `src/proof/test-gen.ts`
   - For each test:
     a. Read current file content
     b. Write base version to file path
     c. Run test in try/finally (always restore current content)
     d. Test PASSES on base → verified (diff introduced the bug)
     e. Test FAILS on base too → drop (pre-existing or false positive)
   - Group tests by finding.file, serialize within group (avoid race conditions)
   - Register SIGINT handler to restore files if interrupted

4. **Integration in `src/runner.ts`** (after existing verify block, lines 211-229)
   - New spinner: "Base-branch check: N tests..."
   - Call `verifyTestsAgainstBase()` on surviving tests
   - Drop findings where test also fails on base
   - Import `resolveBaseRef` from `./diff.js`

5. **Tests in `src/tests/base-verify.test.ts`**
   - resolveBaseRef parses all range formats
   - Test passes on base, fails on new → finding kept
   - Test fails on both → finding dropped
   - New file (not in base) → finding kept
   - File restoration after check

**Edge cases:**
- File renamed: git show fails → skip check, keep finding
- Test imports multiple changed files: only swap primary file
- Concurrent tests on same file: serialize within file group
- --cached range: base = HEAD

---

### Check 2: Fix Minimality Guard

**Status:** Planned, not yet implemented

**Concept:** A one-line bug shouldn't produce a 30-line fix. Count changed lines in the generated fix diff and reject if disproportionate.

**Implementation:**

1. In `src/fix/fix-gen.ts`, inside the attempt loop (after `generateDiff()` at ~line 197):
   - Count lines starting with `+` or `-` in the generated diff (excluding hunk headers)
   - Compute threshold: `max(10, hunkLines * 3)` where hunkLines = total added+removed lines in the original finding's hunk
   - If fix changes more lines than threshold → reject, set previousFailure message, retry

2. No new files needed. No new flags needed. Works within existing retry loop.

**Edge cases:**
- Finding spans multiple hunks: sum all hunk lines for threshold
- Fix legitimately needs many changes (refactor): threshold is generous (3x) and has floor of 10
- Very small files: the 50% size guard already catches this

---

### Check 3: Finding-in-Diff Validation (Tagging)

**Status:** Planned, not yet implemented

**Concept:** Tag findings that reference files or lines outside the actual diff. Don't drop them (they might be real), but make them transparent.

**Implementation:**

1. Add `outsideDiff?: boolean` to `Finding` type in `src/vectors/types.ts`

2. In `src/engine.ts`, after canary filtering (after line 256):
   - Build a Map<string, number[]> of file → hunk line ranges from the DiffFile[] list
   - For each finding:
     a. If finding.file not in the diff files → set outsideDiff = true
     b. If finding.file is in diff but finding.line is more than 50 lines from any hunk → set outsideDiff = true

3. In `src/reporter.ts`:
   - Text format: prepend `[indirect]` tag to findings with outsideDiff=true
   - JSON/SARIF: include outsideDiff field

4. No findings are dropped by this check. It's informational.

**Edge cases:**
- Canary file: already filtered before this step
- Line 0 or negative: already rejected by parseFindings validation
- Files with no hunk line numbers (newStart undefined): skip line check, only validate file presence
