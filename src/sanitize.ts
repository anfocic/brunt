import type { DiffFile } from "./diff.js";

function isInsideString(line: string, index: number): boolean {
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let escaped = false;

  for (let i = 0; i < index; i++) {
    const ch = line[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      escaped = true;
      continue;
    }

    if (ch === "'" && !inDouble && !inTemplate) inSingle = !inSingle;
    else if (ch === '"' && !inSingle && !inTemplate) inDouble = !inDouble;
    else if (ch === "`" && !inSingle && !inDouble) inTemplate = !inTemplate;
  }

  return inSingle || inDouble || inTemplate;
}

function findCommentStart(line: string, marker: string): number {
  let pos = 0;
  while (pos < line.length) {
    const idx = line.indexOf(marker, pos);
    if (idx === -1) return -1;
    if (!isInsideString(line, idx)) return idx;
    pos = idx + marker.length;
  }
  return -1;
}

function stripLineComments(line: string, language: string): string {
  if (["python", "ruby"].includes(language)) {
    for (let i = 0; i < line.length; i++) {
      if (line[i] === "#" && line[i + 1] !== "!" && !isInsideString(line, i)) {
        return line.slice(0, i).trimEnd();
      }
    }
    return line;
  }

  const idx = findCommentStart(line, "//");
  if (idx === -1) return line;
  return line.slice(0, idx).trimEnd();
}

function stripBlockComments(text: string): string {
  let result = "";
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let inBlock = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    const next = text[i + 1];

    if (escaped) {
      escaped = false;
      if (!inBlock) result += ch;
      continue;
    }

    if (ch === "\\") {
      escaped = true;
      if (!inBlock) result += ch;
      continue;
    }

    if (inBlock) {
      if (ch === "*" && next === "/") {
        inBlock = false;
        i++;
      }
      continue;
    }

    const inString = inSingle || inDouble || inTemplate;

    if (!inString && ch === "/" && next === "*") {
      inBlock = true;
      i++;
      continue;
    }

    if (ch === "'" && !inDouble && !inTemplate) inSingle = !inSingle;
    else if (ch === '"' && !inSingle && !inTemplate) inDouble = !inDouble;
    else if (ch === "`" && !inSingle && !inDouble) inTemplate = !inTemplate;

    result += ch;
  }

  return result.trimEnd();
}

function stripHtmlComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, "");
}

function stripLines(lines: string[], language: string): string[] {
  return lines.map((line) => {
    let cleaned = stripLineComments(line, language);
    cleaned = stripBlockComments(cleaned);
    cleaned = stripHtmlComments(cleaned);
    return cleaned;
  }).filter((line) => line.trim().length > 0);
}

export function sanitizeDiff(files: DiffFile[]): DiffFile[] {
  return files.map((file) => ({
    ...file,
    hunks: file.hunks.map((hunk) => ({
      added: stripLines(hunk.added, file.language),
      removed: stripLines(hunk.removed, file.language),
      context: stripLines(hunk.context, file.language),
    })),
  }));
}
