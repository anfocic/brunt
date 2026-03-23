import { execFile } from "node:child_process";
import type { Provider } from "./types.ts";

export class ClaudeCliProvider implements Provider {
  name = "claude-cli";

  async query(prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile("claude", ["-p", prompt], { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`claude-cli failed: ${(stderr ?? "").trim() || error.message}`));
          return;
        }
        resolve((stdout ?? "").trim());
      });
    });
  }
}
