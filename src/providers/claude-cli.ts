import type { Provider } from "./types.ts";

export class ClaudeCliProvider implements Provider {
  name = "claude-cli";

  async query(prompt: string): Promise<string> {
    const proc = Bun.spawn(["claude", "-p", prompt], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      throw new Error(`claude-cli failed: ${stderr.trim()}`);
    }

    return stdout.trim();
  }
}
