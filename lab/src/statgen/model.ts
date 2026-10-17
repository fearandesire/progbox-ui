import { limitRating, ovr, RATING_KEYS } from "../compat.ts";
import type { Player } from "../shim.ts";
import { derivedFeatures, statFeatures, zoneFeatures } from "./features.ts";
import { dot } from "./linalg.ts";
import { ageKey, CUMULATIVE, DERIVED_TARGETS, fromModel, gapBin, GAP_BINS, gpBin, MIN_BINS, mpgBin, ovrBin, RATE_TARGETS, rankBin, type StatGenModel } from "./schema.ts";

type Rng = () => number;

export function gauss(rng: Rng): number {
  let u = 0;
  while (u === 0) u = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

const pick = <T>(rng: Rng, list: T[]): T => list[Math.floor(rng() * list.length)]!;
const lastRow = (p: Player) => p.ratings.at(-1)!;
export const ageOf = (p: Player, season: number) => season - Number(p.born?.year);

/** Sample whole-season playing time for a team's rank and gap from real BBGM seasons. */
function minutesFor(model: StatGenModel, rank: number, gap: number, rng: Rng): number[] {
  const rb = rankBin(rank);
  const gb = gapBin(gap);
  for (let d = 0; d <= GAP_BINS.length; d++) {
    for (const g of d ? [gb - d, gb + d] : [gb]) {
      const cell = model.minutes[`${rb}|${g}`];
      if (cell?.length) return pick(rng, cell);
    }
  }
  return [0, 0, 0, 0];
}

/** Draw one season stat line from ratings, age, role and minutes. */
export function statLine(model: StatGenModel, ratings: Record<string, number>, age: number, mins: number[], teamTop: number, rng: Rng): Record<string, number> | null {
  const [gp, gs, min, minAvailable] = mins as [number, number, number, number];
  if (!(gp > 0 && min > 0)) return null;
  const x = statFeatures(ratings, age, min / gp, teamTop);
  const bin = Math.max(0, MIN_BINS.filter((lo) => min >= lo).length - 1);
  const l = model.stats.noise[bin]!;
  const z = l.map(() => gauss(rng));
  const y = model.stats.coef.map((c, t) => dot(c, x) + l[t]!.reduce((s, v, k) => s + v * z[k]!, 0));
  const out: Record<string, number> = { gp, gs: Math.min(gs, gp), min, minAvailable: Math.max(minAvailable, min) };
  RATE_TARGETS.forEach((k, t) => (out[k] = Math.max(0, Math.round((fromModel(k, y[t]!) * min) / 36))));
  // Makes never exceed attempts; totals follow BBGM's identities (fga = zones + 3PA).
  for (const [m, a] of [["tp", "tpa"], ["fgAtRim", "fgaAtRim"], ["fgLowPost", "fgaLowPost"], ["fgMidRange", "fgaMidRange"], ["ft", "fta"]] as const) out[m] = Math.min(out[m]!, out[a]!);
  out.fga = out.fgaAtRim! + out.fgaLowPost! + out.fgaMidRange! + out.tpa!;
  out.fg = out.fgAtRim! + out.fgLowPost! + out.fgMidRange! + out.tp!;
  out.pts = 2 * (out.fg - out.tp!) + 3 * out.tp! + out.ft!;
  // Stage 2: advanced stats from this box score.
  const dx = derivedFeatures(out, ratings);
  const dl = model.stats.derived.noise[bin]!;
  const dz = dl.map(() => gauss(rng));
  DERIVED_TARGETS.forEach((k, t) => {
    const v = dot(model.stats.derived.coef[t]!, dx) + dl[t]!.reduce((acc, c, j) => acc + c * dz[j]!, 0);
    out[k] = CUMULATIVE.has(k) ? (v * min) / 36 : ["obpm", "dbpm", "per"].includes(k) ? v : Math.max(0, v);
  });
  out.bpm = out.obpm! + out.dbpm!;
  if (out.per === 0) out.per = 1e-6; // NET treats PER 0 as "no stats"; keep real tiny values distinct.
  return out;
}

/** Play one simulated regular season: every rostered player gets a stats row for `season`. */
export function simulateSeason(model: StatGenModel, players: Player[], season: number, rng: Rng): void {
  const teams = new Map<number, Player[]>();
  for (const p of players) if (p.tid >= 0) teams.set(p.tid, [...(teams.get(p.tid) ?? []), p]);
  for (const [tid, roster] of teams) {
    roster.sort((a, b) => lastRow(b).ovr - lastRow(a).ovr);
    const top10 = roster.slice(0, 10);
    const teamTop = top10.reduce((s, p) => s + lastRow(p).ovr, 0) / Math.max(1, top10.length);
    roster.forEach((p, i) => {
      const r = lastRow(p);
      const line = statLine(model, r, ageOf(p, season), minutesFor(model, i + 1, r.ovr - teamTop, rng), teamTop, rng);
      if (!line) return;
      (p.stats ??= []).push({ season, playoffs: false, tid, ...line, statgen: model.version });
    });
  }
}

/** BBGM-style yearly development: resample a real develop() outcome for the player's age. */
export function develop(model: StatGenModel, p: Player, newSeason: number, rng: Rng): void {
  const prev = lastRow(p);
  const age = ageOf(p, newSeason);
  const delta = pick(rng, model.develop[ageKey(age)] ?? model.develop["38"]!);
  const row: Record<string, any> = { ...prev, season: newSeason };
  RATING_KEYS.forEach((k, i) => (row[k] = limitRating(prev[k] + delta[i]!)));
  row.ovr = ovr(row);
  row.pot = age >= 29 ? row.ovr : Math.max(Number(prev.pot) || row.ovr, row.ovr);
  p.ratings.push(row);
}

/**
 * Offseason churn: retirements, a draft class, and roster fill/trim.
 * Returns pids that retired and that were drafted.
 */
export function churn(model: StatGenModel, players: Player[], season: number, nextPid: () => number, rng: Rng): { retired: number[]; drafted: number[] } {
  const retired: number[] = [];
  for (const p of players) {
    if (p.tid < -1) continue;
    const r = lastRow(p);
    const age = ageOf(p, season);
    const prob = model.retire[`${ageKey(age)}|${ovrBin(r.ovr)}`] ?? (age >= 35 ? 0.5 : 0.02);
    if (rng() < prob) {
      p.tid = -3;
      p.retiredYear = season;
      retired.push(p.pid);
    }
  }
  const teamIds = [...new Set(players.filter((p) => p.tid >= 0).map((p) => p.tid))].sort((a, b) => a - b);
  const strength = (tid: number) => {
    const r = players.filter((p) => p.tid === tid).map((p) => lastRow(p).ovr).sort((a, b) => b - a).slice(0, 10);
    return r.reduce((s, v) => s + v, 0) / Math.max(1, r.length);
  };
  // Weakest teams pick first, two rounds; the rest of the class goes to free agency.
  const order = [...teamIds].sort((a, b) => strength(a) - strength(b));
  const classRows = Array.from({ length: model.draftClassSize }, () => pick(rng, model.rookies));
  const prospects = classRows
    .map(([age, ...vals]) => {
      // Prospect ratings are end-of-season ones; develop() then runs on them at the next preseason, as in BBGM.
      const row: Record<string, any> = { season };
      RATING_KEYS.forEach((k, i) => (row[k] = vals[i]));
      row.ovr = ovr(row);
      row.pot = row.ovr;
      return { age: age!, row };
    })
    .sort((a, b) => b.row.ovr - a.row.ovr);
  const drafted: number[] = [];
  prospects.forEach(({ age, row }, i) => {
    const pid = nextPid();
    const tid = i < 2 * order.length ? order[i % order.length]! : -1;
    players.push({ pid, tid, firstName: "Draft", lastName: `${season + 1}-${i + 1}`, born: { year: season - age }, draft: { year: season, round: i < 2 * order.length ? 1 + Math.floor(i / order.length) : 0 }, ratings: [row], stats: [], watch: 0, generated: true } as Player);
    drafted.push(pid);
  });
  // Rosters: release the lowest OVR above the max, sign the best free agents up to the min.
  const fa = () => players.filter((p) => p.tid === -1).sort((a, b) => lastRow(b).ovr - lastRow(a).ovr);
  for (const tid of teamIds) {
    const roster = players.filter((p) => p.tid === tid).sort((a, b) => lastRow(b).ovr - lastRow(a).ovr);
    for (const p of roster.slice(model.rosterTarget.max)) p.tid = -1;
  }
  for (const tid of teamIds) {
    let n = players.filter((p) => p.tid === tid).length;
    for (const p of fa()) {
      if (n >= model.rosterTarget.min) break;
      p.tid = tid;
      n++;
    }
  }
  return { retired, drafted };
}

/** Fill fields an export lacks (shot zones, minAvailable) from the rest of each row. */
export function imputeStats(model: StatGenModel, players: Player[], season: number, fields: string[]): number {
  if (!fields.length) return 0;
  const zones = fields.some((f) => /AtRim|LowPost|MidRange/.test(f));
  let n = 0;
  for (const p of players) {
    const ratings = p.ratings.filter((r) => r.season <= season).at(-1) ?? p.ratings[0];
    for (const s of p.stats ?? []) {
      if (s.season !== season || s.playoffs || !(s.gp > 0)) continue;
      n++;
      if (fields.includes("minAvailable")) s.minAvailable = Math.max(s.min, model.impute.minAvailable[`${gpBin(s.gp)}|${mpgBin(s.min / s.gp)}`] ?? s.gp * 48);
      if (!zones) continue;
      const fga2 = Math.max(0, s.fga - s.tpa);
      const fg2 = Math.max(0, s.fg - s.tp);
      const x = zoneFeatures(ratings, s.min ? (36 * fga2) / s.min : 0, s.min ? (36 * s.tpa) / s.min : 0, fga2 ? fg2 / fga2 : 0.45);
      const [rimShare, postShare, rimPct, postPct, midPct] = model.impute.zoneCoef.map((c) => dot(c, x));
      let shares = [Math.max(0.02, rimShare!), Math.max(0.02, postShare!), Math.max(0.02, 1 - rimShare! - postShare!)];
      const total = shares.reduce((a, b) => a + b, 0);
      shares = shares.map((v) => v / total);
      const att = [Math.round(fga2 * shares[0]!), Math.round(fga2 * shares[1]!)];
      att.push(fga2 - att[0]! - att[1]!);
      // Zone makes follow the predicted zone FG%, rescaled so they add up to the real 2-point makes.
      const raw = [att[0]! * clamp(rimPct!), att[1]! * clamp(postPct!), att[2]! * clamp(midPct!)];
      const scale = raw.reduce((a, b) => a + b, 0) || 1;
      const made = raw.map((v, i) => Math.min(att[i]!, Math.round((v * fg2) / scale)));
      [s.fgaAtRim, s.fgaLowPost, s.fgaMidRange] = att;
      [s.fgAtRim, s.fgLowPost, s.fgMidRange] = made;
      s.imputed = fields;
    }
  }
  return n;
}

const clamp = (v: number) => Math.min(0.95, Math.max(0.05, v));
