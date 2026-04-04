import { describe, test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "fs";
import {
  computeFingerprint,
  loadBaseline,
  saveBaseline,
  filterBaselined,
  BASELINE_VERSION,
  type BaselineEntry,
  type BaselineFile,
} from "../baseline.js";
import type { Finding, VectorReport } from "../vectors/types.js";

const makeFinding = (
  file: string,
  line: number,
  title: string,
  severity: Finding["severity"] = "high"
): Finding => ({
  file,
  line,
  severity,
  title,
  description: `Description for ${title}`,
  reproduction: "call it",
});

const makeEntry = (vector: string, f: Finding): BaselineEntry => ({
  fingerprint: computeFingerprint(vector, f),
  vector,
  file: f.file,
  line: f.line,
  title: f.title,
  severity: f.severity,
});

const TEST_PATH = ".brunt-baseline-test.json";

const cleanup = () => {
  try {
    rmSync(TEST_PATH);
  } catch {}
};

describe("computeFingerprint", () => {
  test("produces consistent fingerprints", () => {
    const f = makeFinding("src/api.ts", 42, "SQL injection");
    const fp1 = computeFingerprint("security", f);
    const fp2 = computeFingerprint("security", f);
    assert.strictEqual(fp1, fp2);
  });

  test("same finding at different lines produces same fingerprint", () => {
    const f1 = makeFinding("src/api.ts", 42, "SQL injection");
    const f2 = makeFinding("src/api.ts", 50, "SQL injection");
    assert.strictEqual(
      computeFingerprint("security", f1),
      computeFingerprint("security", f2)
    );
  });

  test("different files produce different fingerprints", () => {
    const f1 = makeFinding("src/api.ts", 42, "SQL injection");
    const f2 = makeFinding("src/db.ts", 42, "SQL injection");
    assert.notStrictEqual(
      computeFingerprint("security", f1),
      computeFingerprint("security", f2)
    );
  });

  test("different titles produce different fingerprints", () => {
    const f1 = makeFinding("src/api.ts", 42, "SQL injection");
    const f2 = makeFinding("src/api.ts", 42, "XSS vulnerability");
    assert.notStrictEqual(
      computeFingerprint("security", f1),
      computeFingerprint("security", f2)
    );
  });

  test("different vectors produce different fingerprints", () => {
    const f = makeFinding("src/api.ts", 42, "Null dereference");
    assert.notStrictEqual(
      computeFingerprint("correctness", f),
      computeFingerprint("security", f)
    );
  });

  test("normalizes title casing", () => {
    const f1 = makeFinding("src/api.ts", 42, "SQL Injection");
    const f2 = makeFinding("src/api.ts", 42, "sql injection");
    assert.strictEqual(
      computeFingerprint("security", f1),
      computeFingerprint("security", f2)
    );
  });

  test("normalizes title whitespace", () => {
    const f1 = makeFinding("src/api.ts", 42, "SQL  injection");
    const f2 = makeFinding("src/api.ts", 42, "SQL injection");
    assert.strictEqual(
      computeFingerprint("security", f1),
      computeFingerprint("security", f2)
    );
  });

  test("produces 12-char hex string", () => {
    const f = makeFinding("src/api.ts", 42, "SQL injection");
    const fp = computeFingerprint("security", f);
    assert.strictEqual(fp.length, 12);
    assert.match(fp, /^[0-9a-f]{12}$/);
  });
});

describe("loadBaseline / saveBaseline", () => {
  afterEach(cleanup);

  test("returns null for missing file", async () => {
    cleanup();
    const result = await loadBaseline(TEST_PATH);
    assert.strictEqual(result, null);
  });

  test("round-trips baseline entries", async () => {
    const f = makeFinding("src/api.ts", 42, "SQL injection");
    const entries = [makeEntry("security", f)];

    await saveBaseline(entries, TEST_PATH);
    const loaded = await loadBaseline(TEST_PATH);

    assert.notStrictEqual(loaded, null);
    assert.strictEqual(loaded!.version, BASELINE_VERSION);
    assert.strictEqual(loaded!.entries.length, 1);
    assert.strictEqual(loaded!.entries[0].fingerprint, entries[0].fingerprint);
    assert.strictEqual(loaded!.entries[0].file, "src/api.ts");
    assert.strictEqual(loaded!.entries[0].title, "SQL injection");
    assert.ok(loaded!.createdAt);
  });

  test("returns null for corrupted JSON", async () => {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(TEST_PATH, "not json {{{", "utf-8");

    const result = await loadBaseline(TEST_PATH);
    assert.strictEqual(result, null);
  });

  test("returns null for wrong version", async () => {
    const { writeFile } = await import("node:fs/promises");
    const bad: BaselineFile = {
      version: 999,
      createdAt: new Date().toISOString(),
      entries: [],
    };
    await writeFile(TEST_PATH, JSON.stringify(bad), "utf-8");

    const result = await loadBaseline(TEST_PATH);
    assert.strictEqual(result, null);
  });

  test("returns null for missing entries array", async () => {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      TEST_PATH,
      JSON.stringify({ version: BASELINE_VERSION, createdAt: new Date().toISOString() }),
      "utf-8"
    );

    const result = await loadBaseline(TEST_PATH);
    assert.strictEqual(result, null);
  });
});

describe("filterBaselined", () => {
  const baseline = (entries: BaselineEntry[]): BaselineFile => ({
    version: BASELINE_VERSION,
    createdAt: new Date().toISOString(),
    entries,
  });

  test("suppresses findings with matching fingerprint", () => {
    const f = makeFinding("src/api.ts", 42, "SQL injection");
    const reports: VectorReport[] = [
      { name: "security", findings: [f], duration: 100 },
    ];

    const bl = baseline([makeEntry("security", f)]);
    const { filtered, suppressedCount } = filterBaselined(reports, bl);

    assert.strictEqual(suppressedCount, 1);
    assert.strictEqual(filtered[0].findings.length, 0);
  });

  test("keeps findings not in baseline", () => {
    const f1 = makeFinding("src/api.ts", 42, "SQL injection");
    const f2 = makeFinding("src/db.ts", 10, "XSS vulnerability");
    const reports: VectorReport[] = [
      { name: "security", findings: [f1, f2], duration: 100 },
    ];

    const bl = baseline([makeEntry("security", f1)]);
    const { filtered, suppressedCount } = filterBaselined(reports, bl);

    assert.strictEqual(suppressedCount, 1);
    assert.strictEqual(filtered[0].findings.length, 1);
    assert.strictEqual(filtered[0].findings[0].title, "XSS vulnerability");
  });

  test("handles multiple vectors", () => {
    const f1 = makeFinding("src/api.ts", 42, "SQL injection");
    const f2 = makeFinding("src/utils.ts", 10, "Off-by-one");
    const reports: VectorReport[] = [
      { name: "security", findings: [f1], duration: 100 },
      { name: "correctness", findings: [f2], duration: 80 },
    ];

    const bl = baseline([makeEntry("security", f1), makeEntry("correctness", f2)]);
    const { filtered, suppressedCount } = filterBaselined(reports, bl);

    assert.strictEqual(suppressedCount, 2);
    assert.strictEqual(filtered[0].findings.length, 0);
    assert.strictEqual(filtered[1].findings.length, 0);
  });

  test("returns reports unchanged with empty baseline", () => {
    const f = makeFinding("src/api.ts", 42, "SQL injection");
    const reports: VectorReport[] = [
      { name: "security", findings: [f], duration: 100 },
    ];

    const bl = baseline([]);
    const { filtered, suppressedCount } = filterBaselined(reports, bl);

    assert.strictEqual(suppressedCount, 0);
    assert.strictEqual(filtered[0].findings.length, 1);
  });

  test("preserves vector metadata", () => {
    const f = makeFinding("src/api.ts", 42, "SQL injection");
    const reports: VectorReport[] = [
      { name: "security", findings: [f], duration: 150 },
    ];

    const bl = baseline([makeEntry("security", f)]);
    const { filtered } = filterBaselined(reports, bl);

    assert.strictEqual(filtered[0].name, "security");
    assert.strictEqual(filtered[0].duration, 150);
  });

  test("does not mutate original reports", () => {
    const f = makeFinding("src/api.ts", 42, "SQL injection");
    const reports: VectorReport[] = [
      { name: "security", findings: [f], duration: 100 },
    ];

    const bl = baseline([makeEntry("security", f)]);
    filterBaselined(reports, bl);

    assert.strictEqual(reports[0].findings.length, 1);
  });

  test("matches despite line number change", () => {
    const f1 = makeFinding("src/api.ts", 42, "SQL injection");
    const f2 = makeFinding("src/api.ts", 55, "SQL injection");
    const reports: VectorReport[] = [
      { name: "security", findings: [f2], duration: 100 },
    ];

    const bl = baseline([makeEntry("security", f1)]);
    const { filtered, suppressedCount } = filterBaselined(reports, bl);

    assert.strictEqual(suppressedCount, 1);
    assert.strictEqual(filtered[0].findings.length, 0);
  });
});
