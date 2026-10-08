import { compatRandom, limitRating, ovr } from "./compat.ts";

/**
 * Stand-in for the `bbgm` global that BBGM's Worker Console gives scripts.
 * It covers what NET scripts use. Any other access throws ShimGapError with
 * the exact path, so a new script never runs on silently missing data.
 */

export type Player = Record<string, any> & { pid: number; ratings: Record<string, any>[] };

export class ShimGapError extends Error {
  readonly apiPath: string;
  constructor(apiPath: string) {
    super(`bbgm.${apiPath} is not supported by NET Lab yet`);
    this.apiPath = apiPath;
    this.name = "ShimGapError";
  }
}

export const PHASE = {
  EXPANSION_DRAFT: -2,
  FANTASY_DRAFT: -1,
  PRESEASON: 0,
  REGULAR_SEASON: 1,
  PLAYOFFS: 2,
  DRAFT_LOTTERY: 3,
  DRAFT: 4,
  AFTER_DRAFT: 5,
  RESIGN_PLAYERS: 6,
  FREE_AGENCY: 7,
} as const;

export const PLAYER = { FREE_AGENT: -1, UNDRAFTED: -2, RETIRED: -3, UNDRAFTED_FANTASY_TEMP: -6, TOT: -1 } as const;

export type ShimLog = {
  /** Every bbgm.* path the script touched, with call counts. */
  calls: Record<string, number>;
  writes: number[];
  events: Record<string, unknown>[];
  notes: string[];
};

export type ShimOptions = {
  players: Player[];
  season: number;
  phase: number;
  /** Raw export gameAttributes, used for g.get keys other than season/phase. */
  gameAttributes?: Record<string, unknown>;
  math: Math;
};

/** BBGM stores some attributes as [{start, value}] histories; g.get returns the current value. */
function currentValue(value: unknown): unknown {
  if (Array.isArray(value) && value.length && value.every((v) => v && typeof v === "object" && "value" in v)) {
    return (value.at(-1) as { value: unknown }).value;
  }
  return value;
}

function inRange(tid: unknown, key: unknown): boolean {
  if (typeof tid !== "number") return false;
  if (Array.isArray(key)) return tid >= key[0] && tid <= key[1];
  return tid === key;
}

export function createBbgm(opts: ShimOptions): { bbgm: Record<string, unknown>; log: ShimLog } {
  const { players, math } = opts;
  const random = compatRandom(math);
  const log: ShimLog = { calls: {}, writes: [], events: [], notes: [] };
  const attrs: Record<string, unknown> = { ...(opts.gameAttributes ?? {}), season: opts.season, phase: opts.phase };
  const byPid = () => new Map(players.map((p, i) => [p.pid, i]));

  const api = {
    g: {
      get: (key: string) => {
        if (!(key in attrs)) throw new ShimGapError(`g.get("${key}")`);
        return currentValue(attrs[key]);
      },
    },
    PHASE,
    PLAYER,
    idb: {
      cache: {
        players: {
          getAll: async () => players,
          get: async (pid: number) => players.find((p) => p.pid === pid),
          indexGetAll: async (index: string, key: unknown) => {
            if (index !== "playersByTid") throw new ShimGapError(`idb.cache.players.indexGetAll("${index}")`);
            return players.filter((p) => inRange(p.tid, key));
          },
          put: async (p: Player) => {
            const i = byPid().get(p.pid);
            if (i === undefined) players.push(p);
            else players[i] = p;
            log.writes.push(p.pid);
          },
        },
        gameAttributes: {
          get: async (key: string) => {
            if (!(key in attrs)) throw new ShimGapError(`idb.cache.gameAttributes.get("${key}")`);
            return { key, value: currentValue(attrs[key]) };
          },
        },
      },
    },
    player: {
      limitRating,
      ovr: (r: Record<string, number>) => ovr(r),
      addRatingsRow: (p: Player) => {
        const last = p.ratings.at(-1);
        if (!last) throw new Error(`player ${p.pid} has no ratings row to copy`);
        p.ratings.push({ ...structuredClone(last), season: attrs.season });
      },
      develop: async (p: Player, years = 1) => {
        if (years !== 0) throw new ShimGapError(`player.develop(p, ${years}) with years > 0`);
        // develop(p, 0) only recomputes derived values. ovr is exact; pot for 29+ equals ovr in BBGM,
        // younger pot needs BBGM's career simulation and is left unchanged here.
        const row = p.ratings.at(-1)!;
        row.ovr = ovr(row);
        const age = Number(attrs.season) - Number(p.born?.year);
        if (age >= 29) row.pot = row.ovr;
      },
      updateValues: async () => {},
    },
    random,
    helpers: { leagueUrl: (parts: unknown[]) => `/l/1/${parts.join("/")}` },
    logEvent: async (event: Record<string, unknown>) => {
      log.events.push(structuredClone(event));
    },
  };

  return { bbgm: guard(api, "", log), log };
}

/** Wrap every nested object so unknown keys throw and known calls are counted. */
function guard(target: Record<string, any>, prefix: string, log: ShimLog): Record<string, unknown> {
  return new Proxy(target, {
    get(obj, prop, receiver) {
      if (typeof prop === "symbol") return Reflect.get(obj, prop, receiver);
      const pathName = prefix ? `${prefix}.${prop}` : prop;
      if (!(prop in obj)) {
        // `await bbgm.x` probes `then`; JSON/console probe toJSON/inspect hooks.
        if (prop === "then" || prop === "toJSON" || prop === "constructor") return undefined;
        throw new ShimGapError(pathName);
      }
      const value = obj[prop];
      if (typeof value === "function") {
        return (...args: unknown[]) => {
          log.calls[pathName] = (log.calls[pathName] ?? 0) + 1;
          return value(...args);
        };
      }
      if (value && typeof value === "object" && !Array.isArray(value)) return guard(value, pathName, log);
      return value;
    },
    set(_obj, prop) {
      throw new ShimGapError(`${prefix ? `${prefix}.` : ""}${String(prop)} (assignment)`);
    },
  });
}
