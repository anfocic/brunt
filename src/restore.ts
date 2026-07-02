import { readFile, writeFile, unlink } from "node:fs/promises";
import { writeFileSync, unlinkSync } from "node:fs";

export const RESTORE_MANIFEST = ".brunt-restore";

type Manifest = Record<string, string>;

/**
 * On startup, restore any files left swapped on disk by an interrupted run.
 * The manifest can hold many files at once; every entry is restored.
 * Returns true if it restored at least one file.
 */
export async function restoreFromManifest(): Promise<boolean> {
  let raw: string;
  try {
    raw = await readFile(RESTORE_MANIFEST, "utf-8");
  } catch {
    return false;
  }

  let manifest: Manifest;
  try {
    manifest = JSON.parse(raw);
  } catch {
    // Corrupt manifest — drop it so it can't wedge every future run.
    try { await unlink(RESTORE_MANIFEST); } catch {}
    return false;
  }

  const entries = Object.entries(manifest);
  for (const [filePath, content] of entries) {
    try { await writeFile(filePath, content, "utf-8"); } catch {}
  }
  try { await unlink(RESTORE_MANIFEST); } catch {}
  return entries.length > 0;
}

/**
 * Tracks files that are temporarily swapped on disk (base-branch verification,
 * fix application) so they can be restored if the process is interrupted.
 *
 * A single manifest file records the ORIGINAL content of every in-flight file.
 * Concurrent swaps ACCUMULATE into the manifest rather than overwriting it, so
 * a crash mid-run can recover every touched file — not just the last one.
 */
export class RestoreGuard {
  private readonly inFlight = new Map<string, string>();
  private handler?: () => void;

  /**
   * Record a file's original content and persist the manifest BEFORE the
   * on-disk swap. Re-registering an already-tracked file keeps the first
   * (true original) content, so intermediate swaps don't clobber it.
   */
  async register(filePath: string, originalContent: string): Promise<void> {
    if (!this.inFlight.has(filePath)) {
      this.inFlight.set(filePath, originalContent);
      await this.persist();
    }
  }

  /** Drop a file once its final intended content is on disk. */
  async release(filePath: string): Promise<void> {
    if (this.inFlight.delete(filePath)) {
      await this.persist();
    }
  }

  size(): number {
    return this.inFlight.size;
  }

  private async persist(): Promise<void> {
    if (this.inFlight.size === 0) {
      try { await unlink(RESTORE_MANIFEST); } catch {}
      return;
    }
    await writeFile(
      RESTORE_MANIFEST,
      JSON.stringify(Object.fromEntries(this.inFlight)),
      "utf-8"
    );
  }

  /**
   * Install a SIGINT handler that synchronously restores every in-flight file
   * and removes the manifest before exiting. Safe to call more than once.
   */
  installSignalHandler(): void {
    if (this.handler) return;
    this.handler = () => {
      for (const [filePath, content] of this.inFlight) {
        try { writeFileSync(filePath, content, "utf-8"); } catch {}
      }
      try { unlinkSync(RESTORE_MANIFEST); } catch {}
      process.exit(130);
    };
    process.on("SIGINT", this.handler);
  }

  removeSignalHandler(): void {
    if (this.handler) {
      process.removeListener("SIGINT", this.handler);
      this.handler = undefined;
    }
  }
}
