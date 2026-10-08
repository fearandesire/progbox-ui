import fs from "node:fs";
import path from "node:path";
import v8 from "node:v8";
import { RATING_KEYS } from "./compat.ts";
import { baseRow, ovrOf } from "./league.ts";
import { MODELS_DIR } from "./paths.ts";
import { createRng, seededMath } from "./rng.ts";
import { PHASE, type Player } from "./shim.ts";
import { offseason, type Job, type RunResult } from "./simulate.ts";
import { ageOf, churn, develop, simulateSeason } from "./statgen/model.ts";
import type { StatGenModel } from "./statgen/schema.ts";

/**
 * Deep mode: one replicate plays `seasons` offseasons in a row. The first uses
 * the export's real stats; every later one gets a season of StatGen stats,
 * BBGM-style development, retirements, a draft and roster moves first.
 */
export type DeepJob = Job & { seasons: number; modelFile: string };

export type SeasonStats = {
  season: number;
  progressed: number;
  sumDelta: number;
  god: number;
  leagueMeanOvr: number;
  count75: number;
  count80: number;
  maxOvr: number;
  retired: number;
  drafted: number;
  byAge: Record<string, [n: number, sum: number]>;
};

export type DeepResult = {
  run: number;
  seed: number;
  seasons: SeasonStats[];
  /** OVR after each offseason for players on a team at the start (NaN once retired). */
  tracked: { pid: number; ovr: number[] }[];
  calls: Record<string, number>;
  events: Record<string, number>;
  console: string[];
  error?: RunResult["error"] & { season: number };
};

let cachedModel: { file: string; model: StatGenModel } | undefined;
export function loadModel(file = path.join(MODELS_DIR, "statgen.json")): StatGenModel {
  if (cachedModel?.file !== file) cachedModel = { file, model: JSON.parse(fs.readFileSync(file, "utf8")) };
  return cachedModel.model;
}

const AGE_BANDS: [string, number, number][] = [["19-24", 19, 24], ["25-27", 25, 27], ["28-30", 28, 30], ["31-33", 31, 33], ["34+", 34, 200]];
const band = (age: number) => AGE_BANDS.find(([, lo, hi]) => age >= lo && age <= hi)?.[0] ?? "19-24";

/** God progs: every rating except height up by 7+ (NET's flat bonus), same rule as quick mode. */
const isGod = (before: Record<string, number>, after: number[]) => RATING_KEYS.every((k, i) => k === "hgt" || after[i]! - before[k]! >= 7);

export async function runReplicate(job: DeepJob, run: number, seed: number): Promise<DeepResult> {
  const model = loadModel(job.modelFile);
  const players = v8.deserialize(job.playersBuf) as Player[];
  const rng = createRng(seed);
  const math = seededMath(rng);
  // Simulation draws (stats, develop, churn) use their own stream so the script's draws stay comparable across scripts.
  const simRng = createRng(seed ^ 0x5bd1e995);
  let maxPid = Math.max(...players.map((p) => p.pid));
  const nextPid = () => ++maxPid;
  const trackedPids = players.filter((p) => p.tid >= 0).map((p) => p.pid);
  const tracked = new Map(trackedPids.map((pid) => [pid, [] as number[]]));
  const out: DeepResult = { run, seed, seasons: [], tracked: [], calls: {}, events: {}, console: [] };

  let meta = { ...job.meta };
  let churned = { retired: [] as number[], drafted: [] as number[] };
  for (let s = 0; s < job.seasons; s++) {
    if (s > 0) {
      // Play the season just entered, then move to the next preseason the way BBGM does.
      const played = meta.enteringSeason;
      simulateSeason(model, players, played, simRng);
      churned = churn(model, players, played, nextPid, simRng);
      for (const p of players) if (p.tid >= -1 && p.ratings.at(-1)!.season === played) develop(model, p, played + 1, simRng);
      meta = { ...meta, sourceSeason: played + 1, sourcePhase: PHASE.PRESEASON, statsSeason: played, enteringSeason: played + 1, baseDevelop: "export" };
    }
    const result: RunResult = { run, seed, outcomes: [], events: [], calls: {}, console: [] };
    const bases = new Map(players.map((p) => [p.pid, baseRow(p, meta.enteringSeason)]));
    await offseason(players, meta, job, math, result);
    for (const [k, v] of Object.entries(result.calls)) out.calls[k] = (out.calls[k] ?? 0) + v;
    for (const e of result.events) {
      const type = String((e as { type?: unknown }).type ?? "event");
      out.events[type] = (out.events[type] ?? 0) + 1;
    }
    if (!out.console.length) out.console = result.console;
    if (result.error) {
      out.error = { ...result.error, season: meta.enteringSeason };
      break;
    }

    const stats: SeasonStats = { season: meta.enteringSeason, progressed: 0, sumDelta: 0, god: 0, leagueMeanOvr: 0, count75: 0, count80: 0, maxOvr: 0, retired: churned.retired.length, drafted: churned.drafted.length, byAge: {} };
    const byPid = new Map(players.map((p) => [p.pid, p]));
    for (const o of result.outcomes) {
      const base = bases.get(o.pid);
      const p = byPid.get(o.pid);
      if (!base || !p) continue;
      const d = o.ovr - ovrOf(base);
      stats.progressed++;
      stats.sumDelta += d;
      if (isGod(base as Record<string, number>, o.ratings)) stats.god++;
      const b = (stats.byAge[band(ageOf(p, meta.enteringSeason))] ??= [0, 0]);
      b[0]++;
      b[1] += d;
    }
    const active = players.filter((p) => p.tid >= 0).map((p) => ovrOf(p.ratings.at(-1)!));
    stats.leagueMeanOvr = active.reduce((a, b) => a + b, 0) / Math.max(1, active.length);
    stats.count75 = active.filter((v) => v >= 75).length;
    stats.count80 = active.filter((v) => v >= 80).length;
    stats.maxOvr = Math.max(0, ...active);
    out.seasons.push(stats);
    for (const [pid, list] of tracked) {
      const p = byPid.get(pid)!;
      list.push(p.tid === -3 ? Number.NaN : ovrOf(p.ratings.at(-1)!));
    }
  }
  out.tracked = [...tracked].map(([pid, ovr]) => ({ pid, ovr }));
  return out;
}
