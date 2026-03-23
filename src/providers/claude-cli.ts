import { execFile } from "node:child_process";
import type { Provider } from "./types.ts";

const TIMEOUT_MS = 120_000; // 2 minutes

export class ClaudeCliProvider implements Provider {
  name = "claude-cli";

  async query(prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile("claude", ["-p", prompt], { maxBuffer: 10 * 1024 * 1024, timeout: TIMEOUT_MS }, (error, stdout, stderr) => {
        if (error) {
          if ("killed" in error && error.killed) {
            reject(new Error(`claude-cli timed out after ${TIMEOUT_MS / 1000}s`));
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
