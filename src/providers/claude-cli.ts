import { execFile } from "node:child_process";
import type { Provider, ProviderOptions } from "./types.ts";

const DEFAULT_TIMEOUT_MS = 300_000; // 5 minutes

export class ClaudeCliProvider implements Provider {
  name = "claude-cli";
  private model: string | undefined;
  private timeout: number;

  constructor(options: ProviderOptions = {}) {
    this.model = options.model;
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;
  }

  async query(prompt: string): Promise<string> {
    const args = ["-p", prompt];
    if (this.model) {
      args.push("--model", this.model);
    }

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
}
