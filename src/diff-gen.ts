export function generateDiff(original: string, patched: string, filePath: string): string {
  const origLines = original.split("\n");
  const patchLines = patched.split("\n");

  if (origLines.join("\n") === patchLines.join("\n")) {
    return `--- a/${filePath}\n+++ b/${filePath}\n`;
  }

  let out = `--- a/${filePath}\n+++ b/${filePath}\n`;

  const lcs = computeLcs(origLines, patchLines);

  let oi = 0;
  let pi = 0;
  let li = 0;

  type Change = { type: "ctx" | "del" | "add"; line: string; origIdx: number; patchIdx: number };
  const changes: Change[] = [];

  while (oi < origLines.length || pi < patchLines.length) {
    if (li < lcs.length && oi === lcs[li]![0] && pi === lcs[li]![1]) {
      changes.push({ type: "ctx", line: origLines[oi]!, origIdx: oi, patchIdx: pi });
      oi++;
      pi++;
      li++;
    } else if (oi < origLines.length && (li >= lcs.length || oi < lcs[li]![0])) {
      changes.push({ type: "del", line: origLines[oi]!, origIdx: oi, patchIdx: pi });
      oi++;
    } else if (pi < patchLines.length && (li >= lcs.length || pi < lcs[li]![1])) {
      changes.push({ type: "add", line: patchLines[pi]!, origIdx: oi, patchIdx: pi });
      pi++;
    }
  }

  let ci = 0;
  while (ci < changes.length) {
    if (changes[ci]!.type === "ctx") {
      ci++;
      continue;
    }

    let start = ci;
    while (start > 0 && changes[start - 1]!.type === "ctx" && ci - (start - 1) <= 3) start--;

    let end = ci;
    while (end < changes.length) {
      if (changes[end]!.type !== "ctx") {
        end++;
        continue;
      }
      let nextChange = end;
      while (nextChange < changes.length && changes[nextChange]!.type === "ctx") nextChange++;
      if (nextChange < changes.length && nextChange - end <= 6) {
        end = nextChange;
      } else {
        end = Math.min(end + 3, changes.length);
        break;
      }
    }

    let origStart = 0;
    let patchStart = 0;
    let origCount = 0;
    let patchCount = 0;

    for (let k = start; k < end; k++) {
      const c = changes[k]!;
      if (k === start) {
        origStart = c.origIdx + 1;
        patchStart = c.patchIdx + 1;
      }
      if (c.type === "ctx") { origCount++; patchCount++; }
      else if (c.type === "del") origCount++;
      else patchCount++;
    }

    out += `@@ -${origStart},${origCount} +${patchStart},${patchCount} @@\n`;

    for (let k = start; k < end; k++) {
      const c = changes[k]!;
      if (c.type === "ctx") out += ` ${c.line}\n`;
      else if (c.type === "del") out += `-${c.line}\n`;
      else out += `+${c.line}\n`;
    }

    ci = end;
  }

  return out;
}

function computeLcs(a: string[], b: string[]): Array<[number, number]> {
  const m = a.length;
  const n = b.length;

  if (m === 0 || n === 0) return [];

  const full = new Uint16Array((m + 1) * (n + 1));
  for (let ii = 1; ii <= m; ii++) {
    for (let jj = 1; jj <= n; jj++) {
      if (a[ii - 1] === b[jj - 1]) {
        full[ii * (n + 1) + jj] = full[(ii - 1) * (n + 1) + (jj - 1)]! + 1;
      } else {
        full[ii * (n + 1) + jj] = Math.max(
          full[(ii - 1) * (n + 1) + jj]!,
          full[ii * (n + 1) + (jj - 1)]!
        );
      }
    }
  }

  const result: Array<[number, number]> = [];
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      result.push([i - 1, j - 1]);
      i--;
      j--;
    } else if (full[(i - 1) * (n + 1) + j]! >= full[i * (n + 1) + (j - 1)]!) {
      i--;
    } else {
      j--;
    }
  }

  return result.reverse();
}
