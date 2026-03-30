import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { getDiff, isSensitive } from "../diff.js";
import { spawnSync } from "child_process";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

function createTempGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "brunt-test-"));
  spawnSync("git", ["init"], { cwd: dir });
  spawnSync("git", ["config", "user.email", "test@test.com"], { cwd: dir });
  spawnSync("git", ["config", "user.name", "test"], { cwd: dir });

  writeFileSync(join(dir, "initial.ts"), "export const x = 1;\n");
  spawnSync("git", ["add", "."], { cwd: dir });
  spawnSync("git", ["commit", "-m", "init"], { cwd: dir });

  return dir;
}

function withRepo(fn: (dir: string) => Promise<void>) {
  return async () => {
    const dir = createTempGitRepo();
    const origDir = process.cwd();
    try {
      process.chdir(dir);
      await fn(dir);
    } finally {
      process.chdir(origDir);
      rmSync(dir, { recursive: true });
    }
  };
}

describe("isSensitive", () => {
  test("matches .env files", () => {
    assert.strictEqual(isSensitive(".env"), true);
    assert.strictEqual(isSensitive("src/.env"), true);
    assert.strictEqual(isSensitive(".env.local"), true);
    assert.strictEqual(isSensitive(".env.production"), true);
  });

  test("matches secret/credential/password files", () => {
    assert.strictEqual(isSensitive("secrets.json"), true);
    assert.strictEqual(isSensitive("my-credentials.yaml"), true);
    assert.strictEqual(isSensitive("db-password.txt"), true);
  });

  test("matches key/cert files", () => {
    assert.strictEqual(isSensitive("server.key"), true);
    assert.strictEqual(isSensitive("cert.pem"), true);
    assert.strictEqual(isSensitive("keystore.p12"), true);
    assert.strictEqual(isSensitive("id_rsa"), true);
    assert.strictEqual(isSensitive("id_rsa.pub"), true);
  });

  test("does not match normal files", () => {
    assert.strictEqual(isSensitive("index.ts"), false);
    assert.strictEqual(isSensitive("package.json"), false);
    assert.strictEqual(isSensitive("README.md"), false);
  });

  test("matches extra patterns", () => {
    assert.strictEqual(isSensitive("config.private", ["*.private"]), true);
    assert.strictEqual(isSensitive("config.private"), false);
  });
});

describe("getDiff", () => {
  test("parses added lines from a diff", withRepo(async (dir) => {
    writeFileSync(join(dir, "hello.ts"), 'export function hello() {\n  return "world";\n}\n');
    spawnSync("git", ["add", "hello.ts"], { cwd: dir });

    const files = await getDiff("--cached");
    assert.strictEqual(files.length, 1);
    assert.strictEqual(files[0].path, "hello.ts");
    assert.strictEqual(files[0].language, "typescript");
    assert.ok(files[0].hunks.length > 0);
    assert.strictEqual(files[0].hunks[0].added.length, 3);
  }));

  test("detects removed lines", withRepo(async (dir) => {
    writeFileSync(join(dir, "initial.ts"), "export const y = 2;\n");
    spawnSync("git", ["add", "initial.ts"], { cwd: dir });

    const files = await getDiff("--cached");
    assert.strictEqual(files.length, 1);
    assert.ok(files[0].hunks[0].removed.length > 0);
    assert.ok(files[0].hunks[0].added.length > 0);
  }));

  test("filters out lockfiles and images", withRepo(async (dir) => {
    writeFileSync(join(dir, "package-lock.json"), "{}");
    writeFileSync(join(dir, "icon.png"), "fake-png");
    writeFileSync(join(dir, "real.ts"), "export const z = 3;\n");
    spawnSync("git", ["add", "."], { cwd: dir });

    const files = await getDiff("--cached");
    const paths = files.map((f) => f.path);
    assert.ok(paths.includes("real.ts"));
    assert.ok(!paths.includes("package-lock.json"));
    assert.ok(!paths.includes("icon.png"));
  }));

  test("returns empty array for no changes", withRepo(async () => {
    const files = await getDiff("--cached");
    assert.deepStrictEqual(files, []);
  }));

  test("filters sensitive files by default", withRepo(async (dir) => {
    writeFileSync(join(dir, ".env"), "SECRET=abc\n");
    writeFileSync(join(dir, ".env.local"), "SECRET=abc\n");
    writeFileSync(join(dir, "secrets.json"), '{"key": "value"}\n');
    writeFileSync(join(dir, "credentials.yaml"), "token: abc\n");
    writeFileSync(join(dir, "server.key"), "private-key\n");
    writeFileSync(join(dir, "cert.pem"), "certificate\n");
    writeFileSync(join(dir, "real.ts"), "export const z = 3;\n");
    spawnSync("git", ["add", "."], { cwd: dir });

    const files = await getDiff("--cached");
    const paths = files.map((f) => f.path);
    assert.ok(paths.includes("real.ts"));
    assert.ok(!paths.includes(".env"));
    assert.ok(!paths.includes(".env.local"));
    assert.ok(!paths.includes("secrets.json"));
    assert.ok(!paths.includes("credentials.yaml"));
    assert.ok(!paths.includes("server.key"));
    assert.ok(!paths.includes("cert.pem"));
  }));

  test("infers language from extension", withRepo(async (dir) => {
    writeFileSync(join(dir, "app.py"), "x = 1\n");
    writeFileSync(join(dir, "lib.rs"), "fn main() {}\n");
    writeFileSync(join(dir, "index.jsx"), "export default () => null;\n");
    spawnSync("git", ["add", "."], { cwd: dir });

    const files = await getDiff("--cached");
    const langMap = new Map(files.map((f) => [f.path, f.language]));
    assert.strictEqual(langMap.get("app.py"), "python");
    assert.strictEqual(langMap.get("lib.rs"), "rust");
    assert.strictEqual(langMap.get("index.jsx"), "javascript");
  }));
});
