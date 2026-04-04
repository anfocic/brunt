import { execFile, spawn } from "node:child_process";
import type { Provider, ClaudeCliOptions, LlmResponse } from "./types.js";

const DEFAULT_TIMEOUT_MS = 300_000;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ClaudeCliProvider implements Provider {
  readonly name = "claude-cli";
  private readonly model: string | undefined;
  private readonly timeout: number;
  private readonly noConfig: boolean;

  constructor(options: ClaudeCliOptions = {}) {
    this.model = options.model;
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;
    this.noConfig = options.noConfig ?? false;
  }

  async query(prompt: string): Promise<string> {
    const args = this.buildArgs(prompt);

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await this.execClaude(args);
      } catch (err) {
        // Don't retry permanent errors
        const msg = err instanceof Error ? err.message : "";
        if (msg.includes("not found") || msg.includes("timed out")) throw err;
        if (attempt < MAX_RETRIES) {
          await sleep(RETRY_DELAY_MS * Math.pow(2, attempt));
          continue;
        }
        throw err;
      }
    }
    throw new Error("claude-cli: max retries exceeded");
  }

  private execClaude(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile("claude", args, { maxBuffer: 10 * 1024 * 1024, timeout: this.timeout }, (error, stdout, stderr) => {
        if (error) {
          if ("killed" in error && error.killed) {
            reject(new Error(`claude-cli timed out after ${this.timeout / 1000}s`));
            return;
          }
          if ("code" in error && error.code === "ENOENT") {
            reject(new Error('claude-cli: "claude" command not found. Is Claude Code installed?'));
            return;
          }
          reject(new Error(`claude-cli failed: ${(stderr ?? "").trim() || error.message}`));
          return;
        }
        resolve((stdout ?? "").trim());
      });
    });
  }

  async queryRich(system: string | undefined, userPrompt: string): Promise<LlmResponse> {
    const prompt = system ? `${system}\n\n${userPrompt}` : userPrompt;
    const text = await this.query(prompt);
    return { text, usage: { input_tokens: 0, output_tokens: 0 } };
  }

  async *queryStream(prompt: string): AsyncIterable<string> {
    const args = this.buildArgs(prompt);
    const child = spawn("claude", args, { stdio: ["pipe", "pipe", "pipe"] });
    const timeout = setTimeout(() => child.kill(), this.timeout);
    let killed = false;

    child.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timeout);
      if (err.code === "ENOENT") {
        throw new Error('claude-cli: "claude" command not found. Is Claude Code installed?');
      }
    });

    const origKill = child.kill.bind(child);
    child.kill = (...killArgs: Parameters<typeof child.kill>) => {
      killed = true;
      return origKill(...killArgs);
    };

    try {
      if (child.stdout) {
        for await (const chunk of child.stdout) {
          yield chunk.toString();
        }
      }
      if (killed) {
        throw new Error(`claude-cli timed out after ${this.timeout / 1000}s`);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildArgs(prompt: string): string[] {
    const args = ["-p", prompt];
    if (this.noConfig) args.push("--no-config");
    if (this.model) args.push("--model", this.model);
    return args;
  }
}
