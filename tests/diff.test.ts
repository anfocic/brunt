import { describe, test, expect } from "bun:test";
import { getDiff, isSensitive } from "../src/diff.ts";
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
    expect(isSensitive(".env")).toBe(true);
    expect(isSensitive("src/.env")).toBe(true);
    expect(isSensitive(".env.local")).toBe(true);
    expect(isSensitive(".env.production")).toBe(true);
  });

  test("matches secret/credential/password files", () => {
    expect(isSensitive("secrets.json")).toBe(true);
    expect(isSensitive("my-credentials.yaml")).toBe(true);
    expect(isSensitive("db-password.txt")).toBe(true);
  });

  test("matches key/cert files", () => {
    expect(isSensitive("server.key")).toBe(true);
    expect(isSensitive("cert.pem")).toBe(true);
    expect(isSensitive("keystore.p12")).toBe(true);
    expect(isSensitive("id_rsa")).toBe(true);
    expect(isSensitive("id_rsa.pub")).toBe(true);
  });

  test("does not match normal files", () => {
    expect(isSensitive("index.ts")).toBe(false);
    expect(isSensitive("package.json")).toBe(false);
    expect(isSensitive("README.md")).toBe(false);
  });

  test("matches extra patterns", () => {
    expect(isSensitive("config.private", ["*.private"])).toBe(true);
    expect(isSensitive("config.private")).toBe(false);
  });
});

describe("getDiff", () => {
  test("parses added lines from a diff", withRepo(async (dir) => {
    writeFileSync(join(dir, "hello.ts"), 'export function hello() {\n  return "world";\n}\n');
    spawnSync("git", ["add", "hello.ts"], { cwd: dir });

    const files = await getDiff("--cached");
    expect(files.length).toBe(1);
    expect(files[0].path).toBe("hello.ts");
    expect(files[0].language).toBe("typescript");
    expect(files[0].hunks.length).toBeGreaterThan(0);
    expect(files[0].hunks[0].added.length).toBe(3);
  }));

  test("detects removed lines", withRepo(async (dir) => {
    writeFileSync(join(dir, "initial.ts"), "export const y = 2;\n");
    spawnSync("git", ["add", "initial.ts"], { cwd: dir });

    const files = await getDiff("--cached");
    expect(files.length).toBe(1);
    expect(files[0].hunks[0].removed.length).toBeGreaterThan(0);
    expect(files[0].hunks[0].added.length).toBeGreaterThan(0);
  }));

  test("filters out lockfiles and images", withRepo(async (dir) => {
    writeFileSync(join(dir, "package-lock.json"), "{}");
    writeFileSync(join(dir, "icon.png"), "fake-png");
    writeFileSync(join(dir, "real.ts"), "export const z = 3;\n");
    spawnSync("git", ["add", "."], { cwd: dir });

    const files = await getDiff("--cached");
    const paths = files.map((f) => f.path);
    expect(paths).toContain("real.ts");
    expect(paths).not.toContain("package-lock.json");
    expect(paths).not.toContain("icon.png");
  }));

  test("returns empty array for no changes", withRepo(async () => {
    const files = await getDiff("--cached");
    expect(files).toEqual([]);
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
    expect(paths).toContain("real.ts");
    expect(paths).not.toContain(".env");
    expect(paths).not.toContain(".env.local");
    expect(paths).not.toContain("secrets.json");
    expect(paths).not.toContain("credentials.yaml");
    expect(paths).not.toContain("server.key");
    expect(paths).not.toContain("cert.pem");
  }));

  test("sensitive filtering can be disabled", withRepo(async (dir) => {
    writeFileSync(join(dir, ".env"), "SECRET=abc\n");
    writeFileSync(join(dir, "real.ts"), "export const z = 3;\n");
    spawnSync("git", ["add", "."], { cwd: dir });

    const files = await getDiff("--cached", { enabled: false });
    const paths = files.map((f) => f.path);
    expect(paths).toContain(".env");
    expect(paths).toContain("real.ts");
  }));

  test("extra sensitive patterns from config", withRepo(async (dir) => {
    writeFileSync(join(dir, "config.private"), "data\n");
    writeFileSync(join(dir, "real.ts"), "export const z = 3;\n");
    spawnSync("git", ["add", "."], { cwd: dir });

    const files = await getDiff("--cached", { patterns: ["*.private"] });
    const paths = files.map((f) => f.path);
    expect(paths).toContain("real.ts");
    expect(paths).not.toContain("config.private");
  }));

  test("infers language from extension", withRepo(async (dir) => {
    writeFileSync(join(dir, "app.py"), "x = 1\n");
    writeFileSync(join(dir, "lib.rs"), "fn main() {}\n");
    writeFileSync(join(dir, "index.jsx"), "export default () => null;\n");
    spawnSync("git", ["add", "."], { cwd: dir });

    const files = await getDiff("--cached");
    const langMap = new Map(files.map((f) => [f.path, f.language]));
    expect(langMap.get("app.py")).toBe("python");
    expect(langMap.get("lib.rs")).toBe("rust");
    expect(langMap.get("index.jsx")).toBe("javascript");
  }));
});
