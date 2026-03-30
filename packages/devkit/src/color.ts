const enabled = process.env.NO_COLOR === undefined && process.stdout.isTTY !== false;

function wrap(code: number, reset: number): (s: string) => string {
  if (!enabled) return (s) => s;
  return (s) => `\x1b[${code}m${s}\x1b[${reset}m`;
}

export const bold = wrap(1, 22);
export const dim = wrap(2, 22);
export const red = wrap(31, 39);
export const green = wrap(32, 39);
export const yellow = wrap(33, 39);
export const cyan = wrap(36, 39);
export const magenta = wrap(35, 39);
export const gray = wrap(90, 39);

export const boldRed = (s: string) => bold(red(s));
export const boldGreen = (s: string) => bold(green(s));
export const boldYellow = (s: string) => bold(yellow(s));
export const boldMagenta = (s: string) => bold(magenta(s));
