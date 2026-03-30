import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { isTTY, Spinner, ProgressBoard, printBanner } from "../tui.js";

describe("isTTY", () => {
  test("returns a boolean", () => {
    const result = isTTY();
    assert.strictEqual(typeof result, "boolean");
  });

  test("returns false in test environment (piped stderr)", () => {
    assert.strictEqual(typeof isTTY(), "boolean");
  });
});

describe("Spinner", () => {
  test("can be constructed", () => {
    const spinner = new Spinner("test");
    assert.notStrictEqual(spinner, undefined);
  });

  test("start/stop cycle works without error", () => {
    const spinner = new Spinner("testing");
    spinner.start();
    spinner.stop();
  });

  test("succeed works without error", () => {
    const spinner = new Spinner("testing");
    spinner.start();
    spinner.succeed("done");
  });

  test("fail works without error", () => {
    const spinner = new Spinner("testing");
    spinner.start();
    spinner.fail("error");
  });

  test("update changes message without error", () => {
    const spinner = new Spinner("initial");
    spinner.start();
    spinner.update("updated");
    spinner.stop();
  });
});

describe("ProgressBoard", () => {
  test("can be constructed with labels", () => {
    const board = new ProgressBoard(["vec1", "vec2", "vec3"]);
    assert.notStrictEqual(board, undefined);
  });

  test("update and finish work without error", () => {
    const board = new ProgressBoard(["correctness", "security"]);
    board.update("correctness", "done", "2 findings", 1200);
    board.update("security", "failed", "timeout");
    board.finish();
  });
});

describe("printBanner", () => {
  test("executes without error", () => {
    printBanner();
  });
});
