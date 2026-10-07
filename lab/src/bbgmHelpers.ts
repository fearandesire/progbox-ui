import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

/**
 * Exact upstream BBGM helpers (limitRating, ovr, random) pinned by hash in
 * vendor/bbgm/sources.json. The files stay byte-identical; only TypeScript
 * annotations are removed at load time, as NoEyeTest's own tests do.
 */
export const VENDOR_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../vendor/bbgm");

type Sources = { revision: string; files: { file: string; source: string; sha256: string }[] };
export type Ratings = Record<string, number>;

export function readSources(): Sources {
  const sources = JSON.parse(fs.readFileSync(path.join(VENDOR_DIR, "sources.json"), "utf8")) as Sources;
  for (const entry of sources.files) {
    const digest = createHash("sha256").update(fs.readFileSync(path.join(VENDOR_DIR, entry.file))).digest("hex");
    if (digest !== entry.sha256) throw new Error(`vendor/bbgm/${entry.file} hash mismatch: expected ${entry.sha256}, got ${digest}`);
  }
  return sources;
}

function loadDefault<T>(file: string, name: string): T {
  const source = fs
    .readFileSync(path.join(VENDOR_DIR, file), "utf8")
    .replace(/^import type .*;\n/m, "")
    .replace(/: (number|PlayerRatings)/g, "")
    .replace(`export default ${name};`, name);
  return vm.runInNewContext(source) as T;
}

const RANDOM_FUNCTIONS = ["uniform", "uniformSeed", "randInt", "shuffle"] as const;
let randomSource: string | undefined;

/** The unchanged BBGM random helpers, bound to a caller-supplied Math (seeded per run). */
export function bbgmRandom(math: Math): Record<(typeof RANDOM_FUNCTIONS)[number], (...args: any[]) => any> {
  if (!randomSource) {
    const file = fs.readFileSync(path.join(VENDOR_DIR, "random.ts"), "utf8");
    randomSource = RANDOM_FUNCTIONS.map((name) => {
      const match = file.match(new RegExp(`export const ${name} = [\\s\\S]*?\\n};`));
      if (!match) throw new Error(`vendor/bbgm/random.ts is missing ${name}`);
      return match[0]
        .replace("export ", "")
        .replace(/\??: (number|unknown\[\])/g, "")
        .replace(/\): number =>/g, ") =>");
    }).join("\n");
  }
  return vm.runInNewContext(`${randomSource}\n({ ${RANDOM_FUNCTIONS.join(", ")} });`, { Math: math });
}

export type Helpers = { revision: string; limitRating: (r: number) => number; ovr: (r: Ratings) => number };

let cached: Helpers | undefined;
export function bbgmHelpers(): Helpers {
  if (!cached) {
    const { revision } = readSources();
    cached = {
      revision,
      limitRating: loadDefault("limitRating.ts", "limitRating"),
      ovr: loadDefault("ovr.basketball.ts", "ovr"),
    };
  }
  return cached;
}

/** The 15 BBGM basketball rating keys. */
export const RATING_KEYS = ["hgt", "stre", "spd", "jmp", "endu", "ins", "dnk", "ft", "fg", "tp", "oiq", "diq", "drb", "pss", "reb"] as const;
