import { RATING_KEYS } from "./bbgmHelpers.ts";
import { baseRow, ovrOf, ratingsOf, statsRow, type Boundary } from "./league.ts";
import type { RunResult } from "./simulate.ts";

export type PlayerSummary = {
  pid: number;
  name: string;
  tid: number;
  age: number;
  per: number | null;
  bpm: number | null;
  baseOvr: number;
  runs: number;
  meanOvr: number;
  meanDelta: number;
  sdDelta: number;
  min: number;
  q10: number;
  median: number;
  q90: number;
  max: number;
  pctPositive: number;
  godRate: number;
  attrDelta: Record<string, number>;
};

export type Kpis = {
  runs: number;
  failedRuns: number;
  /** Progressed rows holding a rating that is not an integer in 0-100 (BBGM would store garbage). */
  invalidRows: number;
  progressedPerRun: number;
  meanDelta: number;
  sdDelta: number;
  pctPositive: number;
  pctNegative: number;
  deltaByAge: Record<string, { n: number; meanDelta: number }>;
  godProgsPerRun: number;
  medianPlayerSd: number;
  over80Before: number;
  over80After: number;
  p99OvrAfter: number;
  /** OLS coefficients of a player's mean ΔOVR on 1 SD of production, holding age and base OVR fixed. */
  perEffect: number | null;
  bpmEffect: number | null;
};

export type Analysis = {
  kpis: Kpis;
  players: PlayerSummary[];
  errors: { run: number; stage: string; name: string; message: string }[];
  apiCalls: Record<string, number>;
  eventTypes: Record<string, number>;
  console: string[];
};

const AGE_BANDS: [string, number, number][] = [
  ["25-27", 25, 27],
  ["28-30", 28, 30],
  ["31-33", 31, 33],
  ["34+", 34, 200],
];

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const sd = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
};
export function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

/** God progs: every rating except height moves up by at least 7 (NET's flat +7..+13 bonus). */
function isGodLike(delta: number[]): boolean {
  return RATING_KEYS.every((k, i) => k === "hgt" || delta[i]! >= 7);
}

export function analyze(boundary: Boundary, results: RunResult[]): Analysis {
  const info = new Map<number, { name: string; tid: number; age: number; per: number | null; bpm: number | null; base: number[]; baseOvr: number }>();
  for (const p of boundary.players) {
    const row = baseRow(p, boundary.enteringSeason);
    if (!row) continue;
    const s = statsRow(p, boundary.statsSeason);
    const r = ratingsOf(row);
    info.set(p.pid, {
      name: `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || String(p.pid),
      tid: p.tid,
      age: boundary.enteringSeason - Number(p.born?.year),
      per: typeof s?.per === "number" ? s.per : null,
      bpm: typeof s?.obpm === "number" && typeof s?.dbpm === "number" ? s.obpm + s.dbpm : null,
      base: RATING_KEYS.map((k) => r[k]!),
      baseOvr: ovrOf(row),
    });
  }

  const perPlayer = new Map<number, { ovr: number[]; attr: number[]; god: number }>();
  const allDeltas: number[] = [];
  const byAge = new Map<string, number[]>(AGE_BANDS.map(([b]) => [b, []]));
  const over80After: number[] = [];
  const p99: number[] = [];
  let god = 0;
  let invalidRows = 0;
  const errors: Analysis["errors"] = [];
  const activeBase = boundary.players.filter((p) => Number.isInteger(p.tid) && p.tid >= -1 && info.has(p.pid));
  const over80Before = activeBase.filter((p) => info.get(p.pid)!.baseOvr >= 80).length;

  for (const r of results) {
    if (r.error) errors.push({ run: r.run, stage: r.error.stage, name: r.error.name, message: r.error.message });
    const after = new Map(activeBase.map((p) => [p.pid, info.get(p.pid)!.baseOvr]));
    for (const o of r.outcomes) {
      const i = info.get(o.pid);
      if (!i) continue;
      if (o.ratings.some((v) => !Number.isInteger(v) || v < 0 || v > 100)) invalidRows++;
      const delta = o.ratings.map((v, k) => v - i.base[k]!);
      const d = o.ovr - i.baseOvr;
      const acc = perPlayer.get(o.pid) ?? { ovr: [], attr: RATING_KEYS.map(() => 0), god: 0 };
      acc.ovr.push(o.ovr);
      delta.forEach((v, k) => (acc.attr[k]! += v));
      if (isGodLike(delta)) {
        acc.god++;
        god++;
      }
      perPlayer.set(o.pid, acc);
      allDeltas.push(d);
      const band = AGE_BANDS.find(([, lo, hi]) => i.age >= lo && i.age <= hi);
      if (band) byAge.get(band[0])!.push(d);
      after.set(o.pid, o.ovr);
    }
    const values = [...after.values()].sort((a, b) => a - b);
    over80After.push(values.filter((v) => v >= 80).length);
    p99.push(quantile(values, 0.99));
  }

  const players: PlayerSummary[] = [...perPlayer.entries()].map(([pid, acc]) => {
    const i = info.get(pid)!;
    const deltas = acc.ovr.map((o) => o - i.baseOvr).sort((a, b) => a - b);
    return {
      pid,
      name: i.name,
      tid: i.tid,
      age: i.age,
      per: i.per,
      bpm: i.bpm,
      baseOvr: i.baseOvr,
      runs: acc.ovr.length,
      meanOvr: mean(acc.ovr),
      meanDelta: mean(deltas),
      sdDelta: sd(deltas),
      min: deltas[0]!,
      q10: quantile(deltas, 0.1),
      median: quantile(deltas, 0.5),
      q90: quantile(deltas, 0.9),
      max: deltas.at(-1)!,
      pctPositive: deltas.filter((d) => d > 0).length / deltas.length,
      godRate: acc.god / acc.ovr.length,
      attrDelta: Object.fromEntries(RATING_KEYS.map((k, n) => [k, acc.attr[n]! / acc.ovr.length])),
    };
  });
  players.sort((a, b) => b.meanDelta - a.meanDelta);

  const sds = players.map((p) => p.sdDelta).sort((a, b) => a - b);
  const apiCalls: Record<string, number> = {};
  const eventTypes: Record<string, number> = {};
  const first = results[0];
  if (first) {
    Object.assign(apiCalls, first.calls);
    for (const e of first.events) eventTypes[String(e.type)] = (eventTypes[String(e.type)] ?? 0) + 1;
  }

  return {
    kpis: {
      runs: results.length,
      failedRuns: results.filter((r) => r.error).length,
      invalidRows,
      progressedPerRun: results.length ? allDeltas.length / results.length : 0,
      meanDelta: mean(allDeltas),
      sdDelta: sd(allDeltas),
      pctPositive: allDeltas.length ? allDeltas.filter((d) => d > 0).length / allDeltas.length : 0,
      pctNegative: allDeltas.length ? allDeltas.filter((d) => d < 0).length / allDeltas.length : 0,
      deltaByAge: Object.fromEntries([...byAge].map(([b, xs]) => [b, { n: xs.length, meanDelta: mean(xs) }])),
      godProgsPerRun: results.length ? god / results.length : 0,
      medianPlayerSd: quantile(sds, 0.5),
      over80Before,
      over80After: mean(over80After),
      p99OvrAfter: mean(p99),
      perEffect: productionEffect(players, "per"),
      bpmEffect: productionEffect(players, "bpm"),
    },
    players,
    errors,
    apiCalls,
    eventTypes,
    console: first?.console ?? [],
  };
}

/** Coefficient on the standardized stat in meanDelta ~ 1 + age + baseOvr + z(stat). */
function productionEffect(players: PlayerSummary[], key: "per" | "bpm"): number | null {
  const rows = players.filter((p) => typeof p[key] === "number" && Number.isFinite(p[key]));
  if (rows.length < 20) return null;
  const xs = rows.map((p) => p[key] as number);
  const m = mean(xs);
  const s = sd(xs) || 1;
  const X = rows.map((p, i) => [1, p.age, p.baseOvr, (xs[i]! - m) / s]);
  const y = rows.map((p) => p.meanDelta);
  const beta = ols(X, y);
  return beta ? beta[3]! : null;
}

/** Ordinary least squares via normal equations (4 columns, so plain Gaussian elimination is fine). */
export function ols(X: number[][], y: number[]): number[] | null {
  const k = X[0]!.length;
  const A = Array.from({ length: k }, (_, i) => Array.from({ length: k + 1 }, (_, j) => {
    if (j === k) return X.reduce((a, row, n) => a + row[i]! * y[n]!, 0);
    return X.reduce((a, row) => a + row[i]! * row[j]!, 0);
  }));
  for (let c = 0; c < k; c++) {
    let pivot = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(A[r]![c]!) > Math.abs(A[pivot]![c]!)) pivot = r;
    if (Math.abs(A[pivot]![c]!) < 1e-12) return null;
    [A[c], A[pivot]] = [A[pivot]!, A[c]!];
    for (let r = 0; r < k; r++) {
      if (r === c) continue;
      const f = A[r]![c]! / A[c]![c]!;
      for (let j = c; j <= k; j++) A[r]![j]! -= f * A[c]![j]!;
    }
  }
  return A.map((row, i) => row[k]! / row[i]!);
}
