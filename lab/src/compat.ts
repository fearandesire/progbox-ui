/**
 * Our own implementations of the few BBGM behaviors NET scripts depend on:
 * the overall-rating formula, rating clamping, and BBGM's random helpers.
 * Written for NET Lab (no BBGM source is included) and checked against
 * recorded BBGM outputs in fixtures/compat-golden.json.
 */

/** The 15 BBGM basketball rating keys. */
export const RATING_KEYS = ["hgt", "stre", "spd", "jmp", "endu", "ins", "dnk", "ft", "fg", "tp", "oiq", "diq", "drb", "pss", "reb"] as const;
export type Ratings = Record<string, number>;

/** Behavior this module reproduces, recorded in run manifests. */
export const COMPAT_TARGET = "zengm 0ae7a104 (ovr, limitRating, random)";

// Same weights and centers as progbox's C++ engine (api/vendor/progbox_cpp/include/ovr_math.hpp).
const OVR_TERMS: [key: string, weight: number, center: number][] = [
  ["hgt", 0.159, 47.5], ["stre", 0.0777, 50.2], ["spd", 0.123, 50.8], ["jmp", 0.051, 48.7],
  ["endu", 0.0632, 39.9], ["ins", 0.0126, 42.4], ["dnk", 0.0286, 49.5], ["ft", 0.0202, 47.0],
  ["tp", 0.0726, 47.1], ["oiq", 0.133, 46.8], ["diq", 0.159, 46.7], ["drb", 0.059, 54.8],
  ["pss", 0.062, 51.3], ["fg", 0.01, 47.0], ["reb", 0.01, 51.4],
];

/** Piecewise-linear rescale applied to the raw score (pre-2018 scale). */
function fudge(raw: number): number {
  if (raw >= 68) return 8;
  if (raw >= 50) return 4 + ((raw - 50) * 4) / 18;
  if (raw >= 42) return -5 + ((raw - 42) * 9) / 8;
  if (raw >= 31) return -5 - ((42 - raw) * 5) / 11;
  return -10;
}

export function ovr(ratings: Ratings): number {
  let raw = 48.5;
  for (const [key, weight, center] of OVR_TERMS) raw += weight * (ratings[key] - center);
  return Math.min(100, Math.max(0, Math.round(raw + fudge(raw))));
}

/** Clamp to 0..100 and drop the fraction. */
export function limitRating(rating: number): number {
  return rating > 100 ? 100 : rating < 0 ? 0 : Math.floor(rating);
}

/** BBGM's random helpers, drawing from the supplied (seeded) Math. */
export function compatRandom(math: Math) {
  // Deterministic hash for an explicit seed: fractional part of sin(seed) * 1e4.
  const uniformSeed = (seed?: number) => {
    if (seed === undefined) return math.random();
    const x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
  };
  const randInt = (a: number, b: number, seed?: number) => a + Math.floor((seed === undefined ? math.random() : uniformSeed(seed)) * (b - a + 1));
  const uniform = (a: number, b: number) => a + math.random() * (b - a);
  /** In-place forward Fisher-Yates; with a seed, step i uses seed + i. */
  const shuffle = (list: unknown[], seed?: number) => {
    for (let i = 1; i < list.length; i++) {
      const j = randInt(0, i, seed === undefined ? undefined : seed + i);
      if (j !== i) [list[i], list[j]] = [list[j], list[i]];
    }
  };
  return { uniform, uniformSeed, randInt, shuffle };
}
