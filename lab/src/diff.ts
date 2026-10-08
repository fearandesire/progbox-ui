/**
 * Line diff (Myers' O((N+M)·D) algorithm). Rows read top to bottom like a unified diff:
 * `a` is the line number in the old text, `b` in the new one (1-based, null when the
 * line is only on the other side).
 */
export type DiffRow = { op: "ctx" | "add" | "del"; a: number | null; b: number | null; text: string };

export function splitLines(text: string): string[] {
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

export function diffLines(oldText: string, newText: string): DiffRow[] {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  // Common prefix and suffix cost nothing; diff only the middle.
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const rows: DiffRow[] = [];
  for (let i = 0; i < pre; i++) rows.push({ op: "ctx", a: i + 1, b: i + 1, text: a[i]! });
  const am = a.slice(pre, a.length - suf);
  const bm = b.slice(pre, b.length - suf);
  for (const r of myers(am, bm)) rows.push({ ...r, a: r.a === null ? null : r.a + pre, b: r.b === null ? null : r.b + pre });
  for (let i = suf; i > 0; i--) rows.push({ op: "ctx", a: a.length - i + 1, b: b.length - i + 1, text: a[a.length - i]! });
  return rows;
}

function myers(a: string[], b: string[]): DiffRow[] {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  if (!max) return [];
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = false;
  for (let d = 0; d <= max && !found; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!) ? v[offset + k + 1]! : v[offset + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = true;
        break;
      }
    }
  }
  // Walk the trace back from (n, m) to (0, 0).
  const out: DiffRow[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    const vd = trace[d]!;
    const k = x - y;
    const prevK = k === -d || (k !== d && vd[offset + k - 1]! < vd[offset + k + 1]!) ? k + 1 : k - 1;
    const prevX = d === 0 ? 0 : vd[offset + prevK]!;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      out.push({ op: "ctx", a: x, b: y, text: a[x - 1]! });
      x--;
      y--;
    }
    if (d === 0) break;
    if (x === prevX) out.push({ op: "add", a: null, b: y, text: b[y - 1]! });
    else out.push({ op: "del", a: x, b: null, text: a[x - 1]! });
    x = prevX;
    y = prevY;
  }
  return out.reverse();
}
