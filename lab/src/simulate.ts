import v8 from "node:v8";
import { RATING_KEYS } from "./compat.ts";
import { baseRow, enterPreseason, ovrOf, type Boundary } from "./league.ts";
import { createRng, seededMath } from "./rng.ts";
import { runScript } from "./runScript.ts";
import { createBbgm, PHASE, type Player } from "./shim.ts";

export type Script = { name: string; source: string };

/** Everything a worker needs; plain data so it crosses thread boundaries. */
export type Job = {
  meta: Omit<Boundary, "players">;
  playersBuf: Uint8Array;
  pre?: Script;
  script: Script;
};

export type PlayerOutcome = { pid: number; ovr: number; ratings: number[] };

export type RunResult = {
  run: number;
  seed: number;
  outcomes: PlayerOutcome[];
  events: Record<string, unknown>[];
  calls: Record<string, number>;
  console: string[];
  error?: { name: string; message: string; stage: "pre" | "script" };
};

export function packPlayers(players: Player[]): Uint8Array {
  return new Uint8Array(v8.serialize(players));
}

/** One offseason: pre-progs hook, preseason boundary, then the script under test. */
export async function runOnce(job: Job, run: number, seed: number): Promise<RunResult> {
  const players = v8.deserialize(job.playersBuf) as Player[];
  const math = seededMath(createRng(seed));
  const result: RunResult = { run, seed, outcomes: [], events: [], calls: {}, console: [] };
  await offseason(players, job.meta, job, math, result);
  // Only the first run's events and console are reported; dropping the rest keeps 1000-run jobs small.
  if (run !== 0) {
    result.events = [];
    result.console = [];
  }
  return result;
}

/**
 * Run the hook and the script for one boundary on `players` (mutated in place),
 * filling `result` with what the script did.
 */
export async function offseason(players: Player[], meta: Job["meta"], job: Pick<Job, "pre" | "script">, math: Math, result: RunResult): Promise<void> {
  if (job.pre) {
    const preseasonExport = meta.baseDevelop === "export";
    const { bbgm, log } = createBbgm({
      players,
      season: preseasonExport ? meta.statsSeason : meta.sourceSeason,
      phase: preseasonExport ? PHASE.FREE_AGENCY : meta.sourcePhase,
      gameAttributes: meta.gameAttributes,
      math,
    });
    const out = await runScript(job.pre.source, { bbgm, math, filename: job.pre.name });
    mergeCalls(result.calls, log.calls, "pre:");
    if (out.error) {
      result.error = { ...out.error, stage: "pre" };
      return;
    }
  }

  enterPreseason({ ...meta, players: [] }, players);
  const before = new Map(players.map((p) => [p.pid, JSON.stringify(p.ratings.at(-1))]));
  const { bbgm, log } = createBbgm({
    players,
    season: meta.enteringSeason,
    phase: PHASE.PRESEASON,
    gameAttributes: meta.gameAttributes,
    math,
  });
  const out = await runScript(job.script.source, { bbgm, math, filename: job.script.name });
  mergeCalls(result.calls, log.calls, "");
  result.events.push(...log.events);
  if (!result.console.length) result.console = out.console.slice(0, 200);
  if (out.error) result.error = { ...out.error, stage: "script" };

  // A player counts as progressed when the script wrote them back with an entering-season row.
  // Rows the script left untouched are kept out, so BBGM's own progs never count as the script's.
  const written = new Set(log.writes);
  for (const p of players) {
    const row = p.ratings.at(-1);
    if (!row || row.season !== meta.enteringSeason || !baseRow(p, meta.enteringSeason)) continue;
    if (!written.has(p.pid) && before.get(p.pid) === JSON.stringify(row)) continue;
    result.outcomes.push({ pid: p.pid, ovr: ovrOf(row), ratings: RATING_KEYS.map((k) => Number(row[k])) });
  }
}

function mergeCalls(into: Record<string, number>, from: Record<string, number>, prefix: string) {
  for (const [k, v] of Object.entries(from)) into[prefix + k] = (into[prefix + k] ?? 0) + v;
}
