import { VERSION } from "./reporter.ts";
import { RESET, BOLD, DIM, GREEN, RED, CYAN } from "./colors.ts";

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
    const prefix = this.tty ? `${GREEN}\u2714${RESET}` : " ";
    process.stderr.write(`${prefix} ${msg}\n`);
  }

  fail(msg: string) {
    this.stop();
    const prefix = this.tty ? `${RED}\u2718${RESET}` : " ";
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
    process.stderr.write(`\x1b[2K\r${CYAN}${symbol}${RESET} ${this.message}`);
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
      const durStr = entry.duration !== undefined ? ` ${DIM}(${entry.duration}ms)${RESET}` : "";
      const detailStr = entry.detail ? ` ${entry.detail}` : "";
      process.stderr.write(`\x1b[2K  ${icon} ${BOLD}${label}${RESET}${detailStr}${durStr}\n`);
    }

    this.rendered = true;
  }

  private statusIcon(status: string): string {
    switch (status) {
      case "pending":
        return `${DIM}\u2022${RESET}`;
      case "running":
        return `${CYAN}\u25cb${RESET}`;
      case "done":
        return `${GREEN}\u2714${RESET}`;
      case "failed":
        return `${RED}\u2718${RESET}`;
      default:
        return `${DIM}\u2022${RESET}`;
    }
  }
}

const BANNER = `
${BOLD}${CYAN}  ___  ___  _ _ _  _ _____
 | _ )| _ \\| | | || |_   _|
 | _ \\|   /| |_| || | | |
 |___/|_|_\\ \\___/ |_| |_|${RESET}
${DIM}  adversarial AI code review  v${VERSION}${RESET}
`;

export function printBanner() {
  if (!isTTY()) return;
  process.stderr.write(BANNER + "\n");
}
