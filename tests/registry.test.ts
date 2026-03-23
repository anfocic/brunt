import { describe, test, expect } from "bun:test";
import { getVectors, listVectors } from "../src/vectors/registry.ts";

describe("vector registry", () => {
  test("listVectors returns all registered vectors", () => {
    const vectors = listVectors();
    expect(vectors.length).toBe(5);
    const names = vectors.map((v) => v.name);
    expect(names).toContain("correctness");
    expect(names).toContain("security");
    expect(names).toContain("performance");
    expect(names).toContain("resilience");
    expect(names).toContain("business-logic");
  });

  test("getVectors with no args returns all", () => {
    const all = getVectors();
    expect(all.length).toBe(listVectors().length);
  });

  test("getVectors with specific names returns those vectors", () => {
    const vectors = getVectors(["security"]);
    expect(vectors.length).toBe(1);
    expect(vectors[0].name).toBe("security");
  });

  test("getVectors with multiple names returns in order", () => {
    const vectors = getVectors(["security", "correctness"]);
    expect(vectors.length).toBe(2);
    expect(vectors[0].name).toBe("security");
    expect(vectors[1].name).toBe("correctness");
  });

  test("getVectors throws on unknown vector", () => {
    expect(() => getVectors(["nonexistent"])).toThrow("Unknown vector");
  });

  test("each vector has name and description", () => {
    for (const v of listVectors()) {
      expect(v.name.length).toBeGreaterThan(0);
      expect(v.description.length).toBeGreaterThan(0);
      expect(typeof v.analyze).toBe("function");
    }
  });
});
