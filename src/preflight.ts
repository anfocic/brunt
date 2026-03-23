import { execFile } from "node:child_process";

function spawn(cmd: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    execFile(cmd, args, (error) => {
      resolve(error ? 1 : 0);
    });
  });
}

export async function checkGitRepo(): Promise<void> {
  const exitCode = await spawn("git", ["rev-parse", "--git-dir"]);
  if (exitCode !== 0) {
    throw new Error("Not a git repository. Run brunt from inside a git project.");
  }
}

export async function checkProvider(provider: string): Promise<void> {
  if (provider !== "claude-cli") return;

  const exitCode = await spawn("which", ["claude"]);
  if (exitCode !== 0) {
    throw new Error(
      'claude CLI not found. Install Claude Code or use --provider anthropic with an API key.\nSee: https://docs.anthropic.com/en/docs/claude-code'
    );
  }
}
