import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { writeFile, unlink, readFile } from "node:fs/promises";
import {
  readBaseline,
  writeBaseline,
  clearBaseline,
  buildBaselineEntries,
  filterByBaseline,
  type BaselineEntry,
} from "../src/baseline.ts";
import type { Finding, VectorReport } from "../src/vectors/types.ts";

const TEST_PATH = ".brunt-baseline-test.json";

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
  description: "test description",
  reproduction: "test repro",
});

const makeReport = (name: string, findings: Finding[]): VectorReport => ({
  name,
  findings,
  duration: 100,
});

afterEach(async () => {
  await unlink(TEST_PATH).catch(() => {});
});

describe("readBaseline", () => {
  test("returns empty array for missing file", async () => {
    const result = await readBaseline("/nonexistent/path.json");
    expect(result).toEqual([]);
  });

  test("returns empty array for invalid JSON", async () => {
    await writeFile(TEST_PATH, "not json", "utf-8");
    const result = await readBaseline(TEST_PATH);
    expect(result).toEqual([]);
  });

  test("reads valid baseline", async () => {
    const entries: BaselineEntry[] = [
      {
        id: "brunt/security/abc123",
        vectorName: "security",
        file: "src/api.ts",
        line: 42,
        title: "SQL injection",
        severity: "critical",
        addedAt: "2026-03-28T00:00:00.000Z",
      },
    ];
    await writeFile(TEST_PATH, JSON.stringify(entries), "utf-8");
    const result = await readBaseline(TEST_PATH);
    expect(result.length).toBe(1);
    expect(result[0]!.id).toBe("brunt/security/abc123");
  });
});

describe("writeBaseline", () => {
  test("writes sorted JSON", async () => {
    const entries: BaselineEntry[] = [
      { id: "brunt/z/222", vectorName: "z", file: "b.ts", line: 2, title: "B", severity: "low", addedAt: "2026-01-01T00:00:00Z" },
      { id: "brunt/a/111", vectorName: "a", file: "a.ts", line: 1, title: "A", severity: "high", addedAt: "2026-01-01T00:00:00Z" },
    ];
    await writeBaseline(entries, TEST_PATH);
    const raw = await readFile(TEST_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed[0].id).toBe("brunt/a/111");
    expect(parsed[1].id).toBe("brunt/z/222");
  });

  test("round-trips through read", async () => {
    const entries: BaselineEntry[] = [
      { id: "brunt/test/abc", vectorName: "test", file: "x.ts", line: 10, title: "Test", severity: "medium", addedAt: "2026-01-01T00:00:00Z" },
    ];
    await writeBaseline(entries, TEST_PATH);
    const result = await readBaseline(TEST_PATH);
    expect(result.length).toBe(1);
    expect(result[0]!.title).toBe("Test");
  });
});

describe("clearBaseline", () => {
  test("returns true when file exists", async () => {
    await writeFile(TEST_PATH, "[]", "utf-8");
    expect(await clearBaseline(TEST_PATH)).toBe(true);
  });

  test("returns false when file missing", async () => {
    expect(await clearBaseline("/nonexistent.json")).toBe(false);
  });
});

describe("buildBaselineEntries", () => {
  test("converts vector reports to baseline entries", () => {
    const reports: VectorReport[] = [
      makeReport("security", [makeFinding("api.ts", 42, "SQL injection", "critical")]),
      makeReport("correctness", [makeFinding("math.ts", 10, "Off by one")]),
    ];
    const entries = buildBaselineEntries(reports);
    expect(entries.length).toBe(2);
    expect(entries[0]!.vectorName).toBe("security");
    expect(entries[0]!.id).toStartWith("brunt/security/");
    expect(entries[1]!.vectorName).toBe("correctness");
    expect(entries[0]!.addedAt).toBeTruthy();
  });

  test("returns empty for empty reports", () => {
    const entries = buildBaselineEntries([makeReport("test", [])]);
    expect(entries.length).toBe(0);
  });
});

describe("filterByBaseline", () => {
  test("tier 1: suppresses exact ID match", () => {
    const reports = [makeReport("security", [makeFinding("api.ts", 42, "SQL injection")])];
    const baseline = buildBaselineEntries(reports);

    const { filtered, suppressed } = filterByBaseline(reports, baseline);
    expect(suppressed).toBe(1);
    expect(filtered[0]!.findings.length).toBe(0);
  });

  test("tier 2: suppresses fuzzy match (line drift)", () => {
    const original = [makeReport("security", [makeFinding("api.ts", 42, "SQL injection in query")])];
    const baseline = buildBaselineEntries(original);

    // Same file, line shifted by 5, similar title
    const drifted = [makeReport("security", [makeFinding("api.ts", 47, "SQL injection in query handler")])];
    const { filtered, suppressed } = filterByBaseline(drifted, baseline);
    expect(suppressed).toBe(1);
    expect(filtered[0]!.findings.length).toBe(0);
  });

  test("tier 2: does NOT suppress if line drift > 10 and title differs", () => {
    const original = [makeReport("security", [makeFinding("api.ts", 42, "SQL injection in user search")])];
    const baseline = buildBaselineEntries(original);

    // Line far away + different enough title = no match on any tier
    const drifted = [makeReport("security", [makeFinding("api.ts", 100, "Command injection in exec call")])];
    const { filtered, suppressed } = filterByBaseline(drifted, baseline);
    expect(suppressed).toBe(0);
    expect(filtered[0]!.findings.length).toBe(1);
  });

  test("tier 2: does NOT suppress if title too different", () => {
    const original = [makeReport("security", [makeFinding("api.ts", 42, "SQL injection")])];
    const baseline = buildBaselineEntries(original);

    const different = [makeReport("security", [makeFinding("api.ts", 43, "Missing error handling for null return value")])];
    const { filtered, suppressed } = filterByBaseline(different, baseline);
    expect(suppressed).toBe(0);
    expect(filtered[0]!.findings.length).toBe(1);
  });

  test("tier 3: suppresses file rename (same title, different file)", () => {
    const original = [makeReport("security", [makeFinding("old/api.ts", 42, "SQL injection in user query")])];
    const baseline = buildBaselineEntries(original);

    const renamed = [makeReport("security", [makeFinding("new/api.ts", 42, "SQL injection in user query")])];
    const { filtered, suppressed } = filterByBaseline(renamed, baseline);
    expect(suppressed).toBe(1);
    expect(filtered[0]!.findings.length).toBe(0);
  });

  test("passes through new findings not in baseline", () => {
    const baseline = buildBaselineEntries([
      makeReport("security", [makeFinding("api.ts", 42, "SQL injection")]),
    ]);

    const reports = [makeReport("security", [
      makeFinding("api.ts", 42, "SQL injection"),  // baseline match
      makeFinding("auth.ts", 10, "Auth bypass"),    // new
    ])];

    const { filtered, suppressed } = filterByBaseline(reports, baseline);
    expect(suppressed).toBe(1);
    expect(filtered[0]!.findings.length).toBe(1);
    expect(filtered[0]!.findings[0]!.title).toBe("Auth bypass");
  });

  test("handles empty baseline", () => {
    const reports = [makeReport("security", [makeFinding("api.ts", 42, "SQL injection")])];
    const { filtered, suppressed } = filterByBaseline(reports, []);
    expect(suppressed).toBe(0);
    expect(filtered[0]!.findings.length).toBe(1);
  });

  test("handles empty findings", () => {
    const baseline = buildBaselineEntries([
      makeReport("security", [makeFinding("api.ts", 42, "SQL injection")]),
    ]);
    const { filtered, suppressed } = filterByBaseline([makeReport("security", [])], baseline);
    expect(suppressed).toBe(0);
    expect(filtered[0]!.findings.length).toBe(0);
  });

  test("does not cross-suppress across vectors", () => {
    const baseline = buildBaselineEntries([
      makeReport("security", [makeFinding("api.ts", 42, "SQL injection")]),
    ]);

    const reports = [makeReport("correctness", [makeFinding("api.ts", 42, "SQL injection")])];
    const { filtered, suppressed } = filterByBaseline(reports, baseline);
    // Different vector = different findingId, but tier 3 (content hash) includes vector name
    // so this should NOT be suppressed
    expect(filtered[0]!.findings.length).toBe(1);
  });
});
