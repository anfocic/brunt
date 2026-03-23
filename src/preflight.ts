export async function checkGitRepo(): Promise<void> {
  const proc = Bun.spawn(["git", "rev-parse", "--git-dir"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error("Not a git repository. Run brunt from inside a git project.");
  }
}

export async function checkProvider(provider: string): Promise<void> {
  if (provider !== "claude-cli") return;

  const proc = Bun.spawn(["which", "claude"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(
      'claude CLI not found. Install Claude Code or use --provider anthropic with an API key.\nSee: https://docs.anthropic.com/en/docs/claude-code'
    );
  }
}
