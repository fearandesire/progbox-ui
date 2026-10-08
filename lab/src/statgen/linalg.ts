/** Small dense linear algebra for fitting StatGen (dozens of features, not thousands). */

export type Matrix = number[][];

/** Cholesky factor L (lower) of a symmetric positive-definite matrix; adds jitter if needed. */
export function cholesky(a: Matrix): Matrix {
  const n = a.length;
  for (let jitter = 0; jitter < 8; jitter++) {
    const eps = jitter ? 1e-9 * 10 ** jitter : 0;
    const l: Matrix = Array.from({ length: n }, () => new Array(n).fill(0));
    let ok = true;
    for (let i = 0; i < n && ok; i++) {
      for (let j = 0; j <= i; j++) {
        let s = a[i]![j]! + (i === j ? eps : 0);
        for (let k = 0; k < j; k++) s -= l[i]![k]! * l[j]![k]!;
        if (i === j) {
          if (s <= 0) {
            ok = false;
            break;
          }
          l[i]![i] = Math.sqrt(s);
        } else {
          l[i]![j] = s / l[j]![j]!;
        }
      }
    }
    if (ok) return l;
  }
  throw new Error("matrix is not positive definite");
}

/** Solve A x = b given A's Cholesky factor. */
export function cholSolve(l: Matrix, b: number[]): number[] {
  const n = l.length;
  const y = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = b[i]!;
    for (let k = 0; k < i; k++) s -= l[i]![k]! * y[k];
    y[i] = s / l[i]![i]!;
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i];
    for (let k = i + 1; k < n; k++) s -= l[k]![i]! * x[k];
    x[i] = s / l[i]![i]!;
  }
  return x;
}

/**
 * Weighted ridge regression for several targets at once.
 * Returns coefficients[target][feature]; the first feature should be the intercept (not penalized).
 */
export function ridge(x: Matrix, ys: Matrix, w: number[], lambda: number): Matrix {
  const p = x[0]!.length;
  const xtx: Matrix = Array.from({ length: p }, () => new Array(p).fill(0));
  const xty: Matrix = ys[0]!.map(() => new Array(p).fill(0));
  for (let r = 0; r < x.length; r++) {
    const row = x[r]!;
    const wr = w[r]!;
    for (let i = 0; i < p; i++) {
      const xi = row[i]! * wr;
      for (let j = 0; j <= i; j++) xtx[i]![j]! += xi * row[j]!;
      for (let t = 0; t < xty.length; t++) xty[t]![i]! += xi * ys[r]![t]!;
    }
  }
  for (let i = 0; i < p; i++) {
    for (let j = 0; j < i; j++) xtx[j]![i] = xtx[i]![j]!;
    if (i > 0) xtx[i]![i]! += lambda;
  }
  const l = cholesky(xtx);
  return xty.map((b) => cholSolve(l, b));
}

/** Weighted covariance of residual rows. */
export function covariance(rows: Matrix, w?: number[]): Matrix {
  const n = rows[0]!.length;
  const mean = new Array(n).fill(0);
  let tw = 0;
  rows.forEach((r, k) => {
    const wk = w?.[k] ?? 1;
    tw += wk;
    for (let i = 0; i < n; i++) mean[i] += wk * r[i]!;
  });
  for (let i = 0; i < n; i++) mean[i] /= tw;
  const c: Matrix = Array.from({ length: n }, () => new Array(n).fill(0));
  rows.forEach((r, k) => {
    const wk = w?.[k] ?? 1;
    for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) c[i]![j]! += (wk * (r[i]! - mean[i]) * (r[j]! - mean[j])) / tw;
  });
  for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) c[j]![i] = c[i]![j]!;
  return c;
}

export const dot = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i]!, 0);
