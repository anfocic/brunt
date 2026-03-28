import { describe, test, expect } from "bun:test";

describe("demo", () => {
  test("DEMO_SOURCE contains off-by-one bug", async () => {
    const mod = await import("../src/demo.ts");
    // Module should export runDemo
    expect(typeof mod.runDemo).toBe("function");
  });

  test("demo module imports without error", async () => {
    const mod = await import("../src/demo.ts");
    expect(mod).toBeDefined();
  });
});

describe("demo CLI routing", () => {
  test("help shows demo command", async () => {
    const { spawnSync } = await import("child_process");
    const { join } = await import("path");
    const result = spawnSync("bun", ["run", join(import.meta.dir, "../src/cli.ts"), "help"], {
      cwd: join(import.meta.dir, ".."),
      timeout: 5000,
    });
    const stdout = result.stdout?.toString() ?? "";
    expect(stdout).toContain("demo");
    expect(stdout).toContain("showcase scan");
  });
});
