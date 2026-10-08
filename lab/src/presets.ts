/**
 * Locked run sizes. Each was picked so the numbers people act on are stable,
 * and the reasoning is printed in every report. Override only with --unlock.
 */
export const PRESETS = {
  quick: {
    runs: 1000,
    why: "1000 offseasons keep each player's mean ΔOVR within ±0.15 OVR (1 SE) for 95% of players and within ±0.2 for the most volatile, measured on NET 4.3 and 3.2 (per-player SD up to 5.8).",
  },
  deep: {
    seasons: 10,
    replicates: 200,
    why: "10 seasons cover a full prime-to-decline arc for today's players. 200 replicates keep each season's league mean OVR within ±0.05 and the 75+ OVR count within ±0.3 (1 SE); measured on the 2025-26 NBA league with NET 4.3, the worst seasons were ±0.033 and ±0.18.",
  },
} as const;

/**
 * When NET runs:
 * - deep: every offseason for `deep.seasons` seasons ("Every offseason, 10 seasons");
 * - season: plays out this season with StatGen, then NET once ("After one season"; deep with one season, same replicates);
 * - quick: once, right now, on the file's own stats ("Right now").
 */
export const MODES = ["deep", "season", "quick"] as const;
export type Mode = (typeof MODES)[number];
/** Seasons the multi-season part plays (0: quick has none). */
export const seasonsOf = (mode: Mode, deepSeasons: number = PRESETS.deep.seasons) => (mode === "deep" ? deepSeasons : mode === "season" ? 1 : 0);
export const DEFAULT_MODE: Mode = "deep";
