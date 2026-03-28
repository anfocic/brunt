import { describe, test, expect } from "bun:test";

describe("interactive", () => {
  test("module exports runInteractive", async () => {
    const mod = await import("../src/interactive.ts");
    expect(typeof mod.runInteractive).toBe("function");
  });

  test("help shows --interactive flag", async () => {
    const { spawnSync } = await import("child_process");
    const { join } = await import("path");
    const result = spawnSync("bun", ["run", join(import.meta.dir, "../src/cli.ts"), "help"], {
      cwd: join(import.meta.dir, ".."),
      timeout: 5000,
    });
    const stdout = result.stdout?.toString() ?? "";
    expect(stdout).toContain("--interactive");
  });
});

describe("interactive CLI parsing", () => {
  test("--interactive flag is parsed", async () => {
    const { parseArgs } = await import("../src/cli.ts");
    const result = parseArgs(["node", "cli", "scan", "--interactive"]);
    expect(result.interactive).toBe(true);
  });

  test("--interactive defaults to undefined when not set", async () => {
    const { parseArgs } = await import("../src/cli.ts");
    const result = parseArgs(["node", "cli", "scan"]);
    expect(result.interactive).toBeUndefined();
  });
});
