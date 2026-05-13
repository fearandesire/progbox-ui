import { readCppVersion } from "../paths.js";

/** Static v41 config snapshot — mirrors Python engine_adapter._V41_CONFIG */
const V41_CONFIG: Record<string, unknown> = {
  composite: { per: 0.7, dws: 0.2, ewa: 0.1 },
  age_groups: {
    "26-30": { min1: 5, min2: 7, max1: 4, max2: 2, hard_max: 4 },
    "31-34": { min1: 6, min2: 7, max1: 4, max2: 3, hard_max: 2 },
    "35+": { min1: 6, min2: 9, max1: null, max2: null, hard_max: 0 },
  },
  god_prog: {
    chance: 0.02,
    age_limit: 30,
    ovr_limit: 60,
    bonus_min: 7,
    bonus_max: 10,
  },
  ovr_hard_cap: 80,
};

export function scriptVersion(): string {
  return readCppVersion();
}

export function configSnapshot(): Record<string, unknown> {
  return structuredClone(V41_CONFIG);
}
