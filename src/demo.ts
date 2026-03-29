import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { run } from "./runner.ts";
import { exec } from "./util.ts";
import type { Args } from "./cli.ts";

const DEMO_SOURCE = `// shopping-cart.ts — demo file with intentional bugs

export interface CartItem {
  name: string;
  price: number;
  quantity: number;
}

export function calculateTotal(items: CartItem[]): number {
  let total = 0;
  for (let i = 0; i <= items.length; i++) {
    total += items[i].price * items[i].quantity;
  }
  return total;
}

export function applyDiscount(total: number, discountCode: string): number {
  const query = "SELECT discount FROM coupons WHERE code = '" + discountCode + "'";
  // Simulated DB call
  const discount = runQuery(query);
  return total - discount;
}

export function processRefund(userId: string, amount: number): { userId: string; refunded: number } {
  // No validation — negative amounts add credit instead of refunding
  return { userId, refunded: amount };
}

function runQuery(sql: string): number {
  return 0;
}
`;

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout, stderr, exitCode } = await exec("git", args, { cwd });
  if (exitCode !== 0) throw new Error(`git ${args[0]} failed: ${stderr.trim()}`);
  return stdout.trim();
}

export async function runDemo(provider: string, model?: string): Promise<number> {
  const dir = await mkdtemp(join(tmpdir(), "brunt-demo-"));

  try {
    console.error("Setting up demo environment...\n");

    await git(dir, "init");
    await git(dir, "config", "user.email", "demo@brunt.dev");
    await git(dir, "config", "user.name", "brunt-demo");
    await writeFile(join(dir, "shopping-cart.ts"), DEMO_SOURCE, "utf-8");
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ name: "brunt-demo", type: "module", devDependencies: {} }, null, 2),
      "utf-8"
    );
    await git(dir, "add", ".");
    await git(dir, "commit", "-m", "initial commit with buggy code");

    console.error("Demo file: shopping-cart.ts");
    console.error("Bugs planted: off-by-one loop, SQL injection, negative refund exploit\n");

    const originalCwd = process.cwd();
    process.chdir(dir);

    try {
      const args: Args = {
        command: "scan",
        diff: "HEAD~1",
        provider,
        format: "text",
        failOn: "low",
        vectors: ["correctness", "security", "business-logic"],
        noTests: false,
        noCache: true,
        prComment: false,
        fix: true,
        fixRetries: 2,
        interactive: false,
        pr: false,
        consensus: false,
        noBaseline: true,
        model,
      };

      return await run(args);
    } finally {
      process.chdir(originalCwd);
    }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
