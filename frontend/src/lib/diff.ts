export type DiffLineKind = "add" | "del" | "hunk" | "context";

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
}

export interface DiffFile {
  path: string;
  added: number;
  removed: number;
  lines: DiffLine[];
}

function classify(line: string): DiffLineKind {
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "del";
  return "context";
}

export function parseDiff(diff: string): DiffFile[] {
  const files: DiffFile[] = [];
  let current: DiffFile | null = null;
  let inHunks = false;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const match = line.match(/ b\/(.+)$/);
      current = { path: match?.[1] ?? line, added: 0, removed: 0, lines: [] };
      files.push(current);
      inHunks = false;
      continue;
    }
    if (!current) continue;
    if (line.startsWith("@@")) inHunks = true;
    if (!inHunks) continue;
    const kind = classify(line);
    if (kind === "add") current.added += 1;
    if (kind === "del") current.removed += 1;
    current.lines.push({ kind, text: line });
  }
  return files;
}
