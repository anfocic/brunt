import { readFile, stat } from "node:fs/promises";
import type { DiffFile } from "./diff.ts";

const MAX_FILE_SIZE = 50 * 1024; // 50KB

export async function loadContext(files: DiffFile[]): Promise<Map<string, string>> {
  const context = new Map<string, string>();

  const reads = files.map(async (file) => {
    try {
      const info = await stat(file.path);
      if (info.size > MAX_FILE_SIZE) return;

      const content = await readFile(file.path, "utf-8");
      context.set(file.path, content);
    } catch {
      // file might have been deleted in the diff
    }
  });

  await Promise.all(reads);
  return context;
}
