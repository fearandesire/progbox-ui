import { RATING_KEYS } from "../compat.ts";

/** Rating pairs that act together in BBGM's composite ratings. */
const PAIRS: [string, string][] = [
  ["pss", "oiq"], ["pss", "drb"], ["drb", "spd"], ["hgt", "reb"], ["hgt", "ins"], ["hgt", "jmp"], ["dnk", "jmp"],
  ["tp", "oiq"], ["fg", "oiq"], ["diq", "spd"], ["diq", "hgt"], ["stre", "ins"], ["spd", "jmp"], ["endu", "spd"],
];

/** Regression features for the stat model: ratings (and squares), age, role. */
export const STAT_FEATURES = [
  "1",
  ...RATING_KEYS.map((k) => k),
  ...RATING_KEYS.map((k) => `${k}^2`),
  "age",
  "age^2",
  "mpg",
  "mpg^2",
  "teamTop",
  "ovr",
  ...PAIRS.map(([a, b]) => `${a}*${b}`),
];

export function statFeatures(r: Record<string, number>, age: number, mpg: number, teamTop: number): number[] {
  const x = [1];
  for (const k of RATING_KEYS) x.push(r[k]! / 100);
  for (const k of RATING_KEYS) x.push((r[k]! / 100) ** 2);
  const a = (age - 27) / 5;
  const m = mpg / 36;
  x.push(a, a * a, m, m * m, (teamTop - 55) / 10, (r.ovr! - 50) / 10);
  for (const [p, q] of PAIRS) x.push((r[p]! / 100) * (r[q]! / 100));
  return x;
}

/** Features for the shot-zone imputer: ratings plus the observed shot profile. */
export const ZONE_FEATURES = ["1", ...RATING_KEYS.map((k) => k), "fga2_36", "tpa_36", "fg2pct"];

export function zoneFeatures(r: Record<string, number>, fga2per36: number, tpaPer36: number, fg2pct: number): number[] {
  return [1, ...RATING_KEYS.map((k) => r[k]! / 100), fga2per36 / 20, tpaPer36 / 10, fg2pct];
}

const BOX = ["fg", "fga", "tp", "tpa", "ft", "fta", "orb", "drb", "ast", "stl", "blk", "tov", "pf", "pts"];
/** Stage-2 features: per-36 box score, share of team minutes, and ratings. */
export function derivedFeatures(s: Record<string, number>, r: Record<string, number>): number[] {
  const per36 = (k: string) => (36 * (Number(s[k]) || 0)) / s.min!;
  return [1, ...BOX.map(per36), s.min! / s.gp! / 48, ...RATING_KEYS.map((k) => r[k]! / 100)];
}
