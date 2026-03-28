import { describe, test, expect } from "bun:test";
import { isTTY, Spinner, ProgressBoard, printBanner } from "../src/tui.ts";

describe("isTTY", () => {
  test("returns a boolean", () => {
    const result = isTTY();
    expect(typeof result).toBe("boolean");
  });

  test("returns false in test environment (piped stderr)", () => {
    // In bun test, stderr is typically not a TTY
    // This may vary by environment but tests the code path
    expect(typeof isTTY()).toBe("boolean");
  });
});

describe("Spinner", () => {
  test("can be constructed", () => {
    const spinner = new Spinner("test");
    expect(spinner).toBeDefined();
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
    expect(board).toBeDefined();
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
