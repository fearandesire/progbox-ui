import type { LabDiffRow } from "./labTypes";

/** A diff row as drawn: an API row, or a gap standing in for a run of unchanged lines. */
export type ViewRow = LabDiffRow | { op: "gap"; count: number; text: string };

export type DiffView = "smart" | "unified" | "split";

const squash = (t: string) => t.replace(/\s+/g, "");

export function unchangedText(n: number): string {
  return `${n.toLocaleString("en-US")} unchanged line${n === 1 ? "" : "s"}`;
}

/**
 * Treat a block of deletions followed by the same number of additions that differ only
 * in whitespace as unchanged lines (Smart view hides whitespace-only edits).
 */
export function ignoreWhitespace(rows: LabDiffRow[]): LabDiffRow[] {
  const out: LabDiffRow[] = [];
  let i = 0;
  while (i < rows.length) {
    if (rows[i]!.op !== "del") {
      out.push(rows[i]!);
      i++;
      continue;
    }
    let j = i;
    while (j < rows.length && rows[j]!.op === "del") j++;
    let k = j;
    while (k < rows.length && rows[k]!.op === "add") k++;
    const dels = rows.slice(i, j);
    const adds = rows.slice(j, k);
    if (dels.length === adds.length && dels.every((d, n) => squash(d.text) === squash(adds[n]!.text))) {
      adds.forEach((a, n) => out.push({ op: "ctx", a: dels[n]!.a, b: a.b, text: a.text }));
    } else {
      out.push(...dels, ...adds);
    }
    i = k;
  }
  return out;
}

/**
 * Smart view: keep `context` unchanged lines around each change and collapse every
 * longer run of unchanged lines into one gap row. Whitespace-only edits count as unchanged.
 */
export function smartDiff(rows: LabDiffRow[], context = 3): ViewRow[] {
  const clean = ignoreWhitespace(rows);
  const keep = clean.map(() => false);
  clean.forEach((r, i) => {
    if (r.op === "ctx") return;
    for (let k = Math.max(0, i - context); k <= Math.min(clean.length - 1, i + context); k++) keep[k] = true;
  });
  const out: ViewRow[] = [];
  let hidden = 0;
  const flush = () => {
    if (hidden) out.push({ op: "gap", count: hidden, text: unchangedText(hidden) });
    hidden = 0;
  };
  clean.forEach((r, i) => {
    if (keep[i]) {
      flush();
      out.push(r);
    } else hidden++;
  });
  flush();
  return out;
}

export interface SplitLine {
  op: ViewRow["op"] | "empty";
  no: number | null;
  text: string;
}

/**
 * Side-by-side rows: unchanged lines and gaps sit on both sides; each block of
 * deletions is paired line by line with the additions that follow it.
 */
export function splitRows(rows: ViewRow[]): { left: SplitLine; right: SplitLine }[] {
  const out: { left: SplitLine; right: SplitLine }[] = [];
  const empty: SplitLine = { op: "empty", no: null, text: "" };
  let i = 0;
  while (i < rows.length) {
    const r = rows[i]!;
    if (r.op === "gap") {
      const line = { op: "gap" as const, no: null, text: r.text };
      out.push({ left: line, right: line });
      i++;
    } else if (r.op === "ctx") {
      out.push({ left: { op: "ctx", no: r.a, text: r.text }, right: { op: "ctx", no: r.b, text: r.text } });
      i++;
    } else {
      const dels: LabDiffRow[] = [];
      const adds: LabDiffRow[] = [];
      while (i < rows.length && rows[i]!.op === "del") dels.push(rows[i++] as LabDiffRow);
      while (i < rows.length && rows[i]!.op === "add") adds.push(rows[i++] as LabDiffRow);
      for (let n = 0; n < Math.max(dels.length, adds.length); n++) {
        const d = dels[n];
        const a = adds[n];
        out.push({
          left: d ? { op: "del", no: d.a, text: d.text } : empty,
          right: a ? { op: "add", no: a.b, text: a.text } : empty,
        });
      }
    }
  }
  return out;
}

export function changeCount(rows: LabDiffRow[]): { added: number; removed: number } {
  return {
    added: rows.filter((r) => r.op === "add").length,
    removed: rows.filter((r) => r.op === "del").length,
  };
}
