import { createRng } from "../rng.ts";
import type { CorpusRun } from "./fit.ts";
import { statLine } from "./model.ts";
import type { StatGenModel } from "./schema.ts";

/**
 * Calibration gate: on BBGM seasons the model never saw, give each real
 * player-season the same ratings, age and minutes, draw a StatGen line, and
 * compare what NET reads. A model that fails the gate is not used.
 */
export const GATE = { maxKs: 0.1, maxCorrDiff: 0.15 };

/** Per-game or rate values in the shape NET reads them. */
const NET_VIEW: [string, (s: Record<string, number>) => number][] = [
  ["per", (s) => s.per!],
  ["obpm", (s) => s.obpm!],
  ["dbpm", (s) => s.dbpm!],
  ["usgp", (s) => s.usgp!],
  ["astp", (s) => s.astp!],
  ["trbp", (s) => s.trbp!],
  ["orbp", (s) => s.orbp!],
  ["stlp", (s) => s.stlp!],
  ["blkp", (s) => s.blkp!],
  ["ortg", (s) => s.ortg!],
  ["fga/g", (s) => s.fga! / s.gp!],
  ["fta/g", (s) => s.fta! / s.gp!],
  ["tpa/g", (s) => s.tpa! / s.gp!],
  ["tp/g", (s) => s.tp! / s.gp!],
  ["ft/g", (s) => s.ft! / s.gp!],
  ["orb/g", (s) => s.orb! / s.gp!],
  ["tov/g", (s) => s.tov! / s.gp!],
  ["fgaAtRim/g", (s) => s.fgaAtRim! / s.gp!],
  ["fgAtRim/g", (s) => s.fgAtRim! / s.gp!],
  ["fgaLowPost/g", (s) => s.fgaLowPost! / s.gp!],
  ["fgLowPost/g", (s) => s.fgLowPost! / s.gp!],
  ["fgaMidRange/g", (s) => s.fgaMidRange! / s.gp!],
  ["fgMidRange/g", (s) => s.fgMidRange! / s.gp!],
];

function ks(a: number[], b: number[]): number {
  const x = [...a].sort((p, q) => p - q);
  const y = [...b].sort((p, q) => p - q);
  let i = 0;
  let j = 0;
  let d = 0;
  while (i < x.length && j < y.length) {
    if (x[i]! <= y[j]!) i++;
    else j++;
    d = Math.max(d, Math.abs(i / x.length - j / y.length));
  }
  return d;
}

function corr(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < n; i++) {
    sab += (a[i]! - ma) * (b[i]! - mb);
    saa += (a[i]! - ma) ** 2;
    sbb += (b[i]! - mb) ** 2;
  }
  return sab / Math.sqrt(saa * sbb || 1);
}

export function calibrate(model: StatGenModel, holdout: CorpusRun[], seed = 1) {
  const rng = createRng(seed);
  const real: number[][] = [];
  const gen: number[][] = [];
  for (const run of holdout) {
    const top = new Map(run.teams.map((t) => [`${t.season}|${t.tid}`, t.teamOvrTop10 as number]));
    for (const p of run.players) {
      const s = p.stats;
      // NET's pool: players with PER and real minutes.
      if (!s || !(s.min >= 100) || !(s.gp > 0) || !s.per) continue;
      const line = statLine(model, p.ratings, p.age, [s.gp, s.gs, s.min, s.minAvailable], top.get(`${p.season}|${p.tid}`) ?? 55, rng);
      if (!line) continue;
      real.push(NET_VIEW.map(([, f]) => f(s)));
      gen.push(NET_VIEW.map(([, f]) => f(line)));
    }
  }
  const col = (m: number[][], i: number) => m.map((r) => r[i]!);
  const fields = NET_VIEW.map(([name], i) => {
    const r = col(real, i);
    const g = col(gen, i);
    const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
    return { field: name, ks: round(ks(r, g)), realMean: round(mean(r)), genMean: round(mean(g)), fitCorr: round(corr(r, g)) };
  });
  let maxCorrDiff = 0;
  let worstPair = "";
  const pairs: { pair: string; real: number; gen: number }[] = [];
  for (let i = 0; i < NET_VIEW.length; i++) {
    for (let j = 0; j < i; j++) {
      const cr = corr(col(real, i), col(real, j));
      const cg = corr(col(gen, i), col(gen, j));
      const d = Math.abs(cr - cg);
      if (d > 0.08) pairs.push({ pair: `${NET_VIEW[i]![0]} × ${NET_VIEW[j]![0]}`, real: round(cr), gen: round(cg) });
      if (d > maxCorrDiff) {
        maxCorrDiff = d;
        worstPair = `${NET_VIEW[i]![0]} × ${NET_VIEW[j]![0]}`;
      }
    }
  }
  const maxKs = Math.max(...fields.map((f) => f.ks));
  return {
    gate: GATE,
    pass: maxKs <= GATE.maxKs && maxCorrDiff <= GATE.maxCorrDiff,
    n: real.length,
    holdout: holdout.map((h) => h.name),
    maxKs: round(maxKs),
    maxCorrDiff: round(maxCorrDiff),
    worstPair,
    pairs: pairs.sort((a, b) => Math.abs(b.real - b.gen) - Math.abs(a.real - a.gen)),
    fields,
  };
}

const round = (v: number) => Math.round(v * 1000) / 1000;
