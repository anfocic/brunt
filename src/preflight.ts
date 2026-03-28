import { execFile } from "node:child_process";
import { platform } from "node:os";

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

async function checkOllama(model?: string): Promise<void> {
  const host = process.env.OLLAMA_HOST ?? "http://localhost:11434";
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(`${host}/api/tags`, { signal: controller.signal });
      if (!res.ok) throw new Error(`Ollama returned ${res.status}`);

      if (model) {
        const data = (await res.json()) as { models: Array<{ name: string }> };
        const available = data.models.map((m) => m.name.split(":")[0]);
        if (!available.includes(model.split(":")[0])) {
          throw new Error(
            `Model "${model}" not found in Ollama. Available: ${available.join(", ")}. Pull it with: ollama pull ${model}`
          );
        }
      }
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    if (err instanceof TypeError) {
      throw new Error(`Cannot connect to Ollama at ${host}. Start it with: ollama serve`);
    }
    throw err;
  }
}

export async function checkProvider(provider: string, model?: string): Promise<void> {
  if (provider === "claude-cli") {
    const whichCmd = platform() === "win32" ? "where" : "which";
    const exitCode = await spawn(whichCmd, ["claude"]);
    if (exitCode !== 0) {
      throw new Error(
        'claude CLI not found. Install Claude Code or use --provider anthropic with an API key.\nSee: https://docs.anthropic.com/en/docs/claude-code'
      );
    }
  }

  if (provider === "ollama") {
    await checkOllama(model);
  }
}
