import { execFile, spawn } from "node:child_process";
import type { Provider, ClaudeCliOptions, LlmResponse } from "./types.js";

const DEFAULT_TIMEOUT_MS = 300_000;

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

    return new Promise((resolve, reject) => {
      execFile("claude", args, { maxBuffer: 10 * 1024 * 1024, timeout: this.timeout }, (error, stdout, stderr) => {
        if (error) {
          if ("killed" in error && error.killed) {
            reject(new Error(`claude-cli timed out after ${this.timeout / 1000}s`));
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

    try {
      if (child.stdout) {
        for await (const chunk of child.stdout) {
          yield chunk.toString();
        }
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
