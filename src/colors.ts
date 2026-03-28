import type { Severity } from "./vectors/types.ts";

export const RESET = "\x1b[0m";
export const BOLD = "\x1b[1m";
export const DIM = "\x1b[2m";
export const RED = "\x1b[31m";
export const GREEN = "\x1b[32m";
export const YELLOW = "\x1b[33m";
export const CYAN = "\x1b[36m";
export const GRAY = "\x1b[90m";

export const SEVERITY_COLORS: Record<Severity, string> = {
  critical: RED,
  high: YELLOW,
  medium: CYAN,
  low: GRAY,
};
