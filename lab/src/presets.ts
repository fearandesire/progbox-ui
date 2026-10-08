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

export type Mode = keyof typeof PRESETS;
export const DEFAULT_MODE: Mode = "deep";
