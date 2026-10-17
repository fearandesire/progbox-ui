import fs from "node:fs";
import path from "node:path";
import { RATING_KEYS } from "../compat.ts";
import { statFeatures, STAT_FEATURES, zoneFeatures, ZONE_FEATURES } from "./features.ts";
import { cholesky, covariance, dot, ridge } from "./linalg.ts";
import { ageKey, BOX_FOR_DERIVED, CUMULATIVE, DERIVED_TARGETS, gapBin, gpBin, MIN_BINS, mpgBin, ovrBin, RATE_TARGETS, rankBin, toModel, type StatGenModel } from "./schema.ts";
import { derivedFeatures } from "./features.ts";

/**
 * Fit StatGen from a corpus of real BBGM seasons (played privately by the
 * corpus runner). Only fitted numbers and resampled outcomes are kept.
 */

type Row = Record<string, any>;
const readJsonl = (f: string): Row[] => (fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

/** Deterministic subsample so the model file stays small and refits are reproducible. */
function cap<T>(rows: T[], n: number): T[] {
  if (rows.length <= n) return rows;
  const step = rows.length / n;
  return Array.from({ length: n }, (_, i) => rows[Math.floor(i * step)]!);
}

export type CorpusRun = { name: string; players: Row[]; roster: Row[]; progression: Row[]; teams: Row[] };

export function loadCorpus(dirs: string[]): CorpusRun[] {
  return dirs.map((d) => ({
    name: path.basename(d),
    players: readJsonl(path.join(d, "players.jsonl")),
    roster: readJsonl(path.join(d, "roster.jsonl")),
    progression: readJsonl(path.join(d, "progression.jsonl")),
    teams: readJsonl(path.join(d, "teams.jsonl")),
  }));
}

/** One training row per player-season stint, with its role context. */
export function statRows(runs: CorpusRun[]) {
  const out: { x: number[]; y: number[]; min: number; row: Row }[] = [];
  for (const run of runs) {
    const top = new Map(run.teams.map((t) => [`${t.season}|${t.tid}`, t.teamOvrTop10 as number]));
    for (const p of run.players) {
      const s = p.stats;
      if (!s || !(s.min >= 100) || !(s.gp > 0)) continue;
      const mpg = s.min / s.gp;
      const teamTop = top.get(`${p.season}|${p.tid}`) ?? 55;
      const per36 = (v: number) => (36 * v) / s.min;
      const y = RATE_TARGETS.map((k) => toModel(k, per36(Number(s[k]) || 0)));
      if (y.some((v) => !Number.isFinite(v))) continue;
      out.push({ x: statFeatures(p.ratings, p.age, mpg, teamTop), y, min: s.min, row: p });
    }
  }
  return out;
}

export function fitStatModel(rows: ReturnType<typeof statRows>, lambda = 2) {
  const coef = ridge(
    rows.map((r) => r.x),
    rows.map((r) => r.y),
    rows.map((r) => Math.sqrt(r.min)),
    lambda,
  );
  const noise = MIN_BINS.map((lo, i) => {
    const hi = MIN_BINS[i + 1] ?? Infinity;
    const resid = rows.filter((r) => r.min >= Math.max(lo, 100) && r.min < hi).map((r) => r.y.map((v, t) => v - dot(coef[t]!, r.x)));
    return cholesky(covariance(resid));
  });
  // Stage 2: advanced stats from the box score (+ ratings), with residual SD per minute bin.
  const dx = rows.map((r) => derivedFeatures(r.row.stats, r.row.ratings));
  const dy = rows.map((r) => DERIVED_TARGETS.map((k) => (CUMULATIVE.has(k) ? (36 * (Number(r.row.stats[k]) || 0)) / r.min : Number(r.row.stats[k]) || 0)));
  const dcoef = ridge(dx, dy, rows.map((r) => Math.sqrt(r.min)), 0.01);
  const chol = MIN_BINS.map((lo, i) => {
    const hi = MIN_BINS[i + 1] ?? Infinity;
    const idx = rows.map((r, k) => [r, k] as const).filter(([r]) => r.min >= Math.max(lo, 100) && r.min < hi).map(([, k]) => k);
    return cholesky(covariance(idx.map((k) => DERIVED_TARGETS.map((_, t) => dy[k]![t]! - dot(dcoef[t]!, dx[k]!)))));
  });
  return { features: STAT_FEATURES, coef, noise, derived: { coef: dcoef, noise: chol } };
}

export function fitStatGen(runs: CorpusRun[], opts: { zengm: string; version: string }): StatGenModel {
  const rows = statRows(runs);
  const stats = fitStatModel(rows);
  void BOX_FOR_DERIVED;

  // Minutes: whole-season totals per player (traded players' stints summed), by team rank and gap to the team's top-10 average.
  const minutes: Record<string, number[][]> = {};
  for (const run of runs) {
    const top = new Map(run.teams.map((t) => [`${t.season}|${t.tid}`, t.teamOvrTop10 as number]));
    const played = new Map<string, number[]>();
    for (const p of run.players) {
      const k = `${p.season}|${p.pid}`;
      const t = played.get(k) ?? [0, 0, 0, 0];
      const s = p.stats ?? {};
      played.set(k, [t[0]! + (s.gp ?? 0), t[1]! + (s.gs ?? 0), t[2]! + (s.min ?? 0), t[3]! + (s.minAvailable ?? 0)]);
    }
    const byTeam = new Map<string, Row[]>();
    for (const r of run.roster) {
      if (r.snapshot !== "endRegularSeason" || r.tid < 0) continue;
      const k = `${r.season}|${r.tid}`;
      byTeam.set(k, [...(byTeam.get(k) ?? []), r]);
    }
    for (const [k, team] of byTeam) {
      team.sort((a, b) => b.ratings.ovr - a.ratings.ovr);
      team.forEach((r, i) => {
        const cell = `${rankBin(i + 1)}|${gapBin(r.ratings.ovr - (top.get(k) ?? 55))}`;
        (minutes[cell] ??= []).push(played.get(`${r.season}|${r.pid}`) ?? [0, 0, 0, 0]);
      });
    }
  }
  for (const k of Object.keys(minutes)) minutes[k] = cap(minutes[k]!, 300).map((v) => v.map((x) => Math.round(x * 10) / 10));

  // Development: BBGM's own develop() outcomes, by age.
  const develop: Record<string, number[][]> = {};
  for (const run of runs) for (const p of run.progression) (develop[ageKey(p.age)] ??= []).push(RATING_KEYS.map((k) => p.newRatings[k] - p.prevRatings[k]));
  for (const k of Object.keys(develop)) develop[k] = cap(develop[k]!, 500);
  const progressions = runs.reduce((n, r) => n + r.progression.length, 0);

  // Retirement: share of players on a roster or in FA who retire that offseason, by age and OVR.
  const counts: Record<string, [number, number]> = {};
  for (const run of runs) {
    const retired = new Set(run.roster.filter((r) => r.snapshot === "retiredOffseason").map((r) => `${r.season}|${r.pid}`));
    for (const r of run.roster) {
      if (r.snapshot !== "endRegularSeason" || r.tid < -1) continue;
      const k = `${ageKey(r.age)}|${ovrBin(r.ratings.ovr)}`;
      const c = (counts[k] ??= [0, 0]);
      c[0]++;
      if (retired.has(`${r.season}|${r.pid}`)) c[1]++;
    }
  }
  // Smooth toward the age-wide rate so sparse cells don't produce 0% or 100%.
  const byAge: Record<string, [number, number]> = {};
  for (const [k, [n, r]] of Object.entries(counts)) {
    const a = k.split("|")[0]!;
    const c = (byAge[a] ??= [0, 0]);
    c[0] += n;
    c[1] += r;
  }
  const retire: Record<string, number> = {};
  for (const [k, [n, r]] of Object.entries(counts)) {
    const [a] = k.split("|");
    const [an, ar] = byAge[a!]!;
    retire[k] = Math.round(((r + (5 * ar) / an) / (n + 5)) * 1e4) / 1e4;
  }

  // Draft prospects in their draft season.
  const prospects = runs.flatMap((run) => run.roster.filter((r) => r.snapshot === "endRegularSeason" && r.tid === -2 && r.draftYear === r.season));
  const seasonsWithDraft = new Set(prospects.map((p) => `${p.league}|${p.season}`)).size || 1;
  const rookies = cap(prospects.map((r) => [r.age, ...RATING_KEYS.map((k) => r.ratings[k])]), 1500);
  const rosterSizes = runs.flatMap((run) => {
    const c = new Map<string, number>();
    for (const r of run.roster) if (r.snapshot === "endRegularSeason" && r.tid >= 0) c.set(`${r.season}|${r.tid}`, (c.get(`${r.season}|${r.tid}`) ?? 0) + 1);
    return [...c.values()];
  });

  // Imputers. Shot zones: share of 2PA at rim / low post / mid-range and each zone's FG%.
  const zoneTargets = ["shareAtRim", "shareLowPost", "pctAtRim", "pctLowPost", "pctMidRange"];
  const zx: number[][] = [];
  const zy: number[][] = [];
  const zw: number[] = [];
  for (const { row: p, min } of rows) {
    const s = p.stats;
    const fga2 = s.fga - s.tpa;
    if (fga2 < 20) continue;
    const fg2 = s.fg - s.tp;
    const pct = (m: number, a: number, fallback: number) => (a > 0 ? m / a : fallback);
    zx.push(zoneFeatures(p.ratings, (36 * fga2) / min, (36 * s.tpa) / min, fg2 / fga2));
    zy.push([s.fgaAtRim / fga2, s.fgaLowPost / fga2, pct(s.fgAtRim, s.fgaAtRim, 0.6), pct(s.fgLowPost, s.fgaLowPost, 0.45), pct(s.fgMidRange, s.fgaMidRange, 0.38)]);
    zw.push(fga2);
  }
  const zoneCoef = ridge(zx, zy, zw, 1);
  const avail: Record<string, number[]> = {};
  for (const { row: p } of rows) (avail[`${gpBin(p.stats.gp)}|${mpgBin(p.stats.min / p.stats.gp)}`] ??= []).push(p.stats.minAvailable);
  const minAvailable = Object.fromEntries(Object.entries(avail).map(([k, v]) => [k, Math.round(v.sort((a, b) => a - b)[Math.floor(v.length / 2)]!)]));

  return {
    version: opts.version,
    trainedOn: { runs: runs.map((r) => r.name), playerSeasons: rows.length, progressions, zengm: opts.zengm },
    stats,
    minutes,
    develop,
    retire,
    rookies,
    draftClassSize: Math.round(prospects.length / seasonsWithDraft),
    // Typical AI roster sizes (10th to 90th percentile), not the extremes.
    rosterTarget: (() => {
      const sorted = [...rosterSizes].sort((a, b) => a - b);
      return { min: sorted[Math.floor(sorted.length * 0.1)]!, max: sorted[Math.floor(sorted.length * 0.9)]! };
    })(),
    impute: { zoneFeatures: ZONE_FEATURES, zoneCoef, zoneTargets, minAvailable },
  };
}

