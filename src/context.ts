import type { DiffFile } from "./diff.ts";

const MAX_FILE_SIZE = 50 * 1024; // 50KB

export async function loadContext(files: DiffFile[]): Promise<Map<string, string>> {
  const context = new Map<string, string>();

  const reads = files.map(async (file) => {
    try {
      const bunFile = Bun.file(file.path);
      const size = bunFile.size;

      if (size > MAX_FILE_SIZE) return;

      const content = await bunFile.text();
      context.set(file.path, content);
    } catch {
      // file might have been deleted in the diff
    }
  });

  await Promise.all(reads);
  return context;
}
