import { writeFile, readFile, chmod, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { exec } from "./util.ts";

const HOOK_MARKER = "# brunt pre-push hook";

const HOOK_SCRIPT = `#!/bin/sh
${HOOK_MARKER}
# Runs brunt scan before pushing. Remove this file to disable.

# Detect brunt binary
if command -v brunt >/dev/null 2>&1; then
  BRUNT="brunt"
elif command -v npx >/dev/null 2>&1; then
  BRUNT="npx brunt"
elif command -v bunx >/dev/null 2>&1; then
  BRUNT="bunx brunt"
else
  echo "brunt: not found. Skipping pre-push scan."
  exit 0
fi

echo "brunt: running pre-push scan..."
"$BRUNT" scan --no-tests

EXIT_CODE=$?
if [ $EXIT_CODE -ne 0 ]; then
  echo ""
  echo "brunt: scan found issues. Push blocked."
  echo "brunt: run 'brunt scan' for details, or push with --no-verify to skip."
  exit 1
fi
`;

async function getGitDir(): Promise<string> {
  const { stdout, exitCode } = await exec("git", ["rev-parse", "--git-dir"]);
  if (exitCode !== 0) throw new Error("Not a git repository.");
  return stdout.trim();
}

export async function init(): Promise<void> {
  const gitDir = await getGitDir();
  const hooksDir = join(gitDir, "hooks");

  await mkdir(hooksDir, { recursive: true });

  const hookPath = join(hooksDir, "pre-push");

  let existing: string | null = null;
  try {
    existing = await readFile(hookPath, "utf-8");
  } catch {}

  if (existing !== null) {
    if (existing.includes(HOOK_MARKER)) {
      console.log("brunt pre-push hook is already installed.");
      return;
    }
    const appended = existing.trimEnd() + "\n\n" + HOOK_SCRIPT;
    await writeFile(hookPath, appended, "utf-8");
    console.log("brunt pre-push hook appended to existing hook.");
  } else {
    await writeFile(hookPath, HOOK_SCRIPT, "utf-8");
    console.log("brunt pre-push hook installed.");
  }

  await chmod(hookPath, 0o755);
}
