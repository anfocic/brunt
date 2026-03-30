import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { pMap } from "../util.js";

describe("pMap", () => {
  test("processes all items and preserves order", async () => {
    const items = [1, 2, 3, 4, 5];
    const results = await pMap(items, async (n) => n * 2, 3);
    assert.deepStrictEqual(results, [2, 4, 6, 8, 10]);
  });

  test("respects concurrency limit", async () => {
    let active = 0;
    let maxActive = 0;

    const items = [1, 2, 3, 4, 5, 6];
    await pMap(
      items,
      async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 10));
        active--;
      },
      2
    );

    assert.strictEqual(maxActive, 2);
  });

  test("works with concurrency of 1 (sequential)", async () => {
    const order: number[] = [];
    const items = [1, 2, 3];
    await pMap(
      items,
      async (n) => {
        order.push(n);
        await new Promise((r) => setTimeout(r, 5));
      },
      1
    );
    assert.deepStrictEqual(order, [1, 2, 3]);
  });

  test("handles empty array", async () => {
    const results = await pMap([], async () => 1, 3);
    assert.deepStrictEqual(results, []);
  });

  test("concurrency higher than items works", async () => {
    const items = [1, 2];
    const results = await pMap(items, async (n) => n + 10, 10);
    assert.deepStrictEqual(results, [11, 12]);
  });

  test("propagates errors", async () => {
    const items = [1, 2, 3];
    await assert.rejects(
      async () =>
        await pMap(
          items,
          async (n) => {
            if (n === 2) throw new Error("boom");
            return n;
          },
          2
        ),
      { message: /boom/ }
    );
  });
});
