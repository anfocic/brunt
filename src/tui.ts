import { VERSION } from "./reporter.js";
import { bold, dim, green, red, cyan } from "@packages/devkit";

export function isTTY(): boolean {
  return !!(
    process.stderr.isTTY &&
    !process.env.CI &&
    process.env.TERM !== "dumb"
  );
}

const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";

const SPINNER_FRAMES = ["\u2807", "\u280b", "\u2819", "\u2838", "\u2834", "\u2826", "\u2816", "\u280f"];
const SPINNER_INTERVAL = 80;

let cursorHidden = false;

function hideCursor() {
  if (!isTTY() || cursorHidden) return;
  process.stderr.write(HIDE_CURSOR);
  cursorHidden = true;
}

function showCursor() {
  if (!cursorHidden) return;
  process.stderr.write(SHOW_CURSOR);
  cursorHidden = false;
}

process.on("exit", showCursor);
process.on("SIGINT", () => {
  showCursor();
  process.exit(130);
});

export class Spinner {
  private frame = 0;
  private interval: ReturnType<typeof setInterval> | null = null;
  private message: string;
  private tty: boolean;

  constructor(message: string) {
    this.message = message;
    this.tty = isTTY();
  }

  start(msg?: string) {
    if (msg) this.message = msg;
    if (!this.tty) {
      process.stderr.write(`  ${this.message}\n`);
      return;
    }
    hideCursor();
    this.render();
    this.interval = setInterval(() => this.render(), SPINNER_INTERVAL);
  }

  update(msg: string) {
    this.message = msg;
    if (!this.tty) {
      process.stderr.write(`  ${msg}\n`);
    }
  }

  succeed(msg: string) {
    this.stop();
    const prefix = this.tty ? green("\u2714") : " ";
    process.stderr.write(`${prefix} ${msg}\n`);
  }

  fail(msg: string) {
    this.stop();
    const prefix = this.tty ? red("\u2718") : " ";
    process.stderr.write(`${prefix} ${msg}\n`);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (this.tty) {
      process.stderr.write("\x1b[2K\r");
      showCursor();
    }
  }

  private render() {
    const symbol = SPINNER_FRAMES[this.frame % SPINNER_FRAMES.length];
    process.stderr.write(`\x1b[2K\r${cyan(symbol)} ${this.message}`);
    this.frame++;
  }
}

export class ProgressBoard {
  private lines: Map<string, { status: string; detail: string; duration?: number }>;
  private labels: string[];
  private rendered = false;
  private tty: boolean;

  constructor(labels: string[]) {
    this.labels = labels;
    this.tty = isTTY();
    this.lines = new Map();
    for (const label of labels) {
      this.lines.set(label, { status: "pending", detail: "" });
    }
  }

  update(label: string, status: string, detail?: string, duration?: number) {
    this.lines.set(label, { status, detail: detail ?? "", duration });
    if (this.tty) {
      this.render();
    } else {
      const durStr = duration !== undefined ? ` (${duration}ms)` : "";
      process.stderr.write(`  ${label}: ${status}${detail ? ` - ${detail}` : ""}${durStr}\n`);
    }
  }

  finish() {
    if (this.tty && this.rendered) {
      this.render();
      process.stderr.write("\n");
      showCursor();
    }
  }

  private render() {
    if (this.rendered) {
      process.stderr.write(`\x1b[${this.labels.length}A`);
    }
    hideCursor();

    for (const label of this.labels) {
      const entry = this.lines.get(label)!;
      const icon = this.statusIcon(entry.status);
      const durStr = entry.duration !== undefined ? ` ${dim(`(${entry.duration}ms)`)}` : "";
      const detailStr = entry.detail ? ` ${entry.detail}` : "";
      process.stderr.write(`\x1b[2K  ${icon} ${bold(label)}${detailStr}${durStr}\n`);
    }

    this.rendered = true;
  }

  private statusIcon(status: string): string {
    switch (status) {
      case "pending":
        return dim("\u2022");
      case "running":
        return cyan("\u25cb");
      case "done":
        return green("\u2714");
      case "failed":
        return red("\u2718");
      default:
        return dim("\u2022");
    }
  }
}

const BANNER = `
${bold(cyan(`  ___  ___  _ _ _  _ _____
 | _ )| _ \\| | | || |_   _|
 | _ \\|   /| |_| || | | |
 |___/|_|_\\\\ \\___/ |_| |_|`))}
${dim(`  adversarial AI code review  v${VERSION}`)}
`;

export function printBanner() {
  if (!isTTY()) return;
  process.stderr.write(BANNER + "\n");
}
