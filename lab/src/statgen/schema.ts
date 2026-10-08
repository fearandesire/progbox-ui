/** Shared shapes for the StatGen model file (models/statgen.json). */

/** Stage 1: per-36 box-score rates, drawn jointly (correlated noise) from ratings, age and role. */
export const RATE_TARGETS = ["tpa", "tp", "fgaAtRim", "fgAtRim", "fgaLowPost", "fgLowPost", "fgaMidRange", "fgMidRange", "fta", "ft", "orb", "drb", "ast", "tov", "stl", "blk", "pf"] as const;
/**
 * Stage 2: advanced stats follow from the box score (R² 0.95-0.998 in BBGM's own output for
 * PER, OBPM, ORtg, USG% and rate stats; 0.67-0.79 for DBPM, DRtg, DWS), plus ratings. Per-36 for the cumulative ones.
 */
export const DERIVED_TARGETS = ["per", "obpm", "dbpm", "ortg", "drtg", "usgp", "astp", "trbp", "orbp", "drbp", "stlp", "blkp", "ows", "dws", "ewa", "vorp"] as const;
export const CUMULATIVE = new Set(["ows", "dws", "ewa", "vorp"]);
export const BOX_FOR_DERIVED = ["fg", "fga", "tp", "tpa", "ft", "fta", "orb", "drb", "ast", "stl", "blk", "tov", "pf", "pts"] as const;

/** Skewed, non-negative targets are modeled as log(value + offset) so noise has the right shape. */
export const LOG_OFFSET: Record<string, number> = {
  tpa: 0.3, tp: 0.15, fgaAtRim: 0.3, fgAtRim: 0.2, fgaLowPost: 0.3, fgLowPost: 0.2, fgaMidRange: 0.3, fgMidRange: 0.2,
  fta: 0.3, ft: 0.2, orb: 0.2, drb: 0.3, ast: 0.2, tov: 0.2, stl: 0.1, blk: 0.1, pf: 0.3,
};
export const toModel = (k: string, v: number) => (k in LOG_OFFSET ? Math.log(Math.max(0, v) + LOG_OFFSET[k]!) : v);
export const fromModel = (k: string, v: number) => (k in LOG_OFFSET ? Math.max(0, Math.exp(v) - LOG_OFFSET[k]!) : v);

/** Minute bins for residual covariance (noise shrinks as minutes grow). */
export const MIN_BINS = [0, 300, 900, 1600, 2300] as const;

export type StatModel = {
  features: string[];
  coef: number[][]; // [target][feature]
  /** Cholesky factor of the residual covariance, per minute bin. */
  noise: number[][][];
  /** Stage 2: [target][1, box per-36..., mpg/48, ratings/100...] and residual Cholesky per minute bin. */
  derived: { coef: number[][]; noise: number[][][] };
};

/** Hot-deck cells: real BBGM outcomes resampled by situation. */
export type MinutesCell = number[][]; // rows of [gp, gs, min, minAvailable]

export type StatGenModel = {
  version: string;
  trainedOn: { runs: string[]; playerSeasons: number; progressions: number; zengm: string };
  stats: StatModel;
  /** key `${rank}|${gapBin}` → [gp, gs, min, minAvailable] rows. */
  minutes: Record<string, MinutesCell>;
  /** age → 15-rating delta vectors (RATING_KEYS order), from BBGM's own develop(). */
  develop: Record<string, number[][]>;
  /** `${age}|${ovrBin}` → yearly retirement probability. */
  retire: Record<string, number>;
  /** Draft prospects: [age, ...15 ratings]. */
  rookies: number[][];
  draftClassSize: number;
  rosterTarget: { min: number; max: number };
  /** Imputers for exports that lack fields NET reads. */
  impute: {
    zoneFeatures: string[];
    zoneCoef: number[][]; // [zoneShare/zonePct target][feature]
    zoneTargets: string[];
    /** `${gpBin}|${mpgBin}` → median minAvailable. */
    minAvailable: Record<string, number>;
  };
  calibration?: Record<string, unknown>;
};

export const GAP_BINS = [-10, -5, 0, 5] as const;
export const gapBin = (gap: number) => GAP_BINS.filter((b) => gap >= b).length;
export const rankBin = (rank: number) => Math.min(Math.max(rank, 1), 14);
export const ageKey = (age: number) => String(Math.min(Math.max(age, 19), 38));
export const ovrBin = (ovr: number) => Math.min(Math.max(Math.floor(ovr / 5) * 5, 30), 75);
export const gpBin = (gp: number) => Math.min(Math.floor(gp / 10), 8);
export const mpgBin = (mpg: number) => Math.min(Math.floor(mpg / 6), 7);
