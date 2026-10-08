import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { TIMINGS_FILE } from "./paths.ts";

/**
 * Run-time estimates from measured timings on this host. Every finished run
 * appends how long one unit took (an offseason in quick mode, one
 * replicate-season in deep mode). Estimates pool the most recent comparable runs,
 * weighted by size, so short test runs (mostly start-up time) don't skew them.
 */
export type Timing = { at: string; mode: "quick" | "deep"; scriptSha: string; league?: string; units: number; workers: number; ms: number; cpus: number };

const cpus = () => os.availableParallelism();

export function recordTiming(t: Omit<Timing, "at" | "cpus">) {
  fs.mkdirSync(path.dirname(TIMINGS_FILE), { recursive: true });
  fs.appendFileSync(TIMINGS_FILE, JSON.stringify({ at: new Date().toISOString(), cpus: cpus(), ...t }) + "\n");
}

function history(): Timing[] {
  if (!fs.existsSync(TIMINGS_FILE)) return [];
  return fs.readFileSync(TIMINGS_FILE, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

/** Milliseconds per unit per worker, preferring runs of the same script and league on a same-sized host. */
export function msPerUnit(mode: Timing["mode"], scriptSha?: string, league?: string): { ms: number; basis: string } | null {
  const all = history().filter((t) => t.mode === mode && t.cpus === cpus() && t.units > 0);
  const tiers: [Timing[], string][] = [
    [all.filter((t) => t.scriptSha === scriptSha && t.league === league), " with this script and league"],
    [all.filter((t) => t.league === league), " on this league"],
    [all.filter((t) => t.scriptSha === scriptSha), " with this script"],
    [all, ""],
  ];
  const [found, where] = tiers.find(([t]) => t.length) ?? [[], ""];
  const pool = found.slice(-10);
  if (!pool.length) return null;
  const units = pool.reduce((a, t) => a + t.units, 0);
  const ms = pool.reduce((a, t) => a + t.ms * t.workers, 0) / units;
  return { ms, basis: `${pool.length} measured ${mode} run${pool.length > 1 ? "s" : ""} on this host${where}, ${units} units, weighted by size` };
}

export const defaultWorkers = () => Math.max(1, cpus() - 1);

/** Seconds for a run. `probe` measures a handful of units when there's no history yet. */
export async function estimate(
  parts: { mode: Timing["mode"]; units: number; scriptSha: string; league?: string }[],
  workers: number,
  probe: (mode: Timing["mode"], scriptSha: string) => Promise<number>,
): Promise<{ seconds: number; basis: string[] }> {
  let ms = 0;
  const basis: string[] = [];
  for (const part of parts) {
    let per = msPerUnit(part.mode, part.scriptSha, part.league);
    if (!per) {
      const probeMs = await probe(part.mode, part.scriptSha);
      per = { ms: probeMs, basis: `measured just now with a short ${part.mode} probe` };
    }
    ms += (per.ms * part.units) / workers;
    basis.push(`${part.mode}: ${per.ms.toFixed(0)} ms per ${part.mode === "quick" ? "offseason" : "replicate-season"} per worker (${per.basis})`);
  }
  // League load and report writing, measured at about 2 s on the default league.
  return { seconds: Math.round(ms / 1000 + 2), basis };
}
