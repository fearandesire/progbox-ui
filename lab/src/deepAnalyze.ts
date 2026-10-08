import type { DeepResult } from "./deep.ts";
import { quantile } from "./analyze.ts";
import type { Flag } from "./report.ts";

export type Stat = { mean: number; se: number };
export type DeepSeason = {
  season: number;
  progressed: Stat;
  meanDelta: Stat;
  god: Stat;
  leagueMeanOvr: Stat;
  count75: Stat;
  count80: Stat;
  maxOvr: Stat;
  retired: Stat;
  drafted: Stat;
};
export type DeepAnalysis = {
  replicates: number;
  failed: number;
  errors: { run: number; season: number; name: string; message: string }[];
  seasons: DeepSeason[];
  /** Mean script ΔOVR by age band, over all seasons. */
  ageCurve: Record<string, number>;
  /** Players on a team at the start: OVR after each offseason (mean, p10, p90; null once mostly retired). */
  trajectories: { pid: number; ovr: { mean: number; p10: number; p90: number; active: number }[] }[];
  calls: Record<string, number>;
  events: Record<string, number>;
};

const stat = (xs: number[]): Stat => {
  const n = xs.length;
  if (!n) return { mean: 0, se: 0 };
  const m = xs.reduce((a, b) => a + b, 0) / n;
  const v = n > 1 ? xs.reduce((a, x) => a + (x - m) ** 2, 0) / (n - 1) : 0;
  return { mean: m, se: Math.sqrt(v / n) };
};

export function analyzeDeep(results: DeepResult[]): DeepAnalysis {
  const ok = results.filter((r) => !r.error);
  const seasons = Math.max(0, ...ok.map((r) => r.seasons.length));
  const out: DeepAnalysis = { replicates: results.length, failed: results.length - ok.length, errors: [], seasons: [], ageCurve: {}, trajectories: [], calls: {}, events: {} };
  for (const r of results) {
    if (r.error) out.errors.push({ run: r.run, season: r.error.season, name: r.error.name, message: r.error.message });
    for (const [k, v] of Object.entries(r.calls)) out.calls[k] = (out.calls[k] ?? 0) + v;
    for (const [k, v] of Object.entries(r.events)) out.events[k] = (out.events[k] ?? 0) + v;
  }
  for (let s = 0; s < seasons; s++) {
    const rows = ok.map((r) => r.seasons[s]).filter((x): x is NonNullable<typeof x> => !!x);
    const col = (f: (x: (typeof rows)[number]) => number) => stat(rows.map(f));
    out.seasons.push({
      season: rows[0]!.season,
      progressed: col((x) => x.progressed),
      meanDelta: col((x) => (x.progressed ? x.sumDelta / x.progressed : 0)),
      god: col((x) => x.god),
      leagueMeanOvr: col((x) => x.leagueMeanOvr),
      count75: col((x) => x.count75),
      count80: col((x) => x.count80),
      maxOvr: col((x) => x.maxOvr),
      retired: col((x) => x.retired),
      drafted: col((x) => x.drafted),
    });
  }
  const bands: Record<string, [number, number]> = {};
  for (const r of ok) for (const s of r.seasons) for (const [b, [n, sum]] of Object.entries(s.byAge)) {
    const acc = (bands[b] ??= [0, 0]);
    acc[0] += n;
    acc[1] += sum;
  }
  out.ageCurve = Object.fromEntries(Object.entries(bands).sort().map(([b, [n, sum]]) => [b, n ? sum / n : 0]));

  const pids = ok[0]?.tracked.map((t) => t.pid) ?? [];
  out.trajectories = pids.map((pid, i) => ({
    pid,
    ovr: Array.from({ length: seasons }, (_, s) => {
      const vals = ok.map((r) => r.tracked[i]?.ovr[s]).filter((v): v is number => Number.isFinite(v)).sort((a, b) => a - b);
      return { mean: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : Number.NaN, p10: quantile(vals, 0.1), p90: quantile(vals, 0.9), active: vals.length / Math.max(1, ok.length) };
    }),
  }));
  return out;
}

const sign = (x: number) => (x > 0 ? `+${x.toFixed(2)}` : x.toFixed(2));

/** Multi-season flags: drift that only shows up when progs compound. */
export function deepFlags(a: DeepAnalysis, base?: DeepAnalysis): Flag[] {
  const flags: Flag[] = [];
  if (a.failed) flags.push({ level: "error", text: `${a.failed}/${a.replicates} deep replicates failed: ${a.errors[0]!.name}: ${a.errors[0]!.message} (season ${a.errors[0]!.season}).` });
  const last = a.seasons.at(-1);
  const first = a.seasons[0];
  if (!last || !first) return flags;
  const years = a.seasons.length;
  if (base?.seasons.at(-1)) {
    const b = base.seasons.at(-1)!;
    const drift = last.leagueMeanOvr.mean - b.leagueMeanOvr.mean;
    if (Math.abs(drift) > 1) flags.push({ level: "warn", text: `After ${years} seasons, league mean OVR is ${sign(drift)} vs baseline (${last.leagueMeanOvr.mean.toFixed(1)} vs ${b.leagueMeanOvr.mean.toFixed(1)}).` });
    const stars = last.count75.mean - b.count75.mean;
    if (stars > Math.max(3, b.count75.mean * 0.5)) flags.push({ level: "warn", text: `After ${years} seasons there are ${last.count75.mean.toFixed(1)} players at 75+ OVR vs ${b.count75.mean.toFixed(1)} on baseline.` });
    if (stars < -Math.max(3, b.count75.mean * 0.5)) flags.push({ level: "warn", text: `After ${years} seasons there are only ${last.count75.mean.toFixed(1)} players at 75+ OVR vs ${b.count75.mean.toFixed(1)} on baseline.` });
  } else if (Math.abs(last.leagueMeanOvr.mean - first.leagueMeanOvr.mean) > 2) {
    flags.push({ level: "warn", text: `League mean OVR moves ${sign(last.leagueMeanOvr.mean - first.leagueMeanOvr.mean)} over ${years} seasons.` });
  }
  return flags;
}

export function deepMarkdown(a: DeepAnalysis, name: string, base?: { name: string; analysis: DeepAnalysis }): string {
  const lines = [`## Over ${a.seasons.length} seasons (${a.replicates} replicates)`, ""];
  const cell = (s: Stat, d = 1) => `${s.mean.toFixed(d)} ±${s.se.toFixed(d === 0 ? 1 : d + 1)}`;
  const head = base ? `| Season | League mean OVR (${base.name} → ${name}) | 75+ players | 80+ players | Best OVR | God progs | Mean script Δ |` : "| Season | League mean OVR | 75+ players | 80+ players | Best OVR | God progs | Mean script Δ |";
  lines.push(head, "|---|---|---|---|---|---|---|");
  a.seasons.forEach((s, i) => {
    const b = base?.analysis.seasons[i];
    const pair = (f: (x: DeepSeason) => Stat, d = 1) => (b ? `${f(b).mean.toFixed(d)} → ${cell(f(s), d)}` : cell(f(s), d));
    lines.push(`| ${s.season} | ${pair((x) => x.leagueMeanOvr, 2)} | ${pair((x) => x.count75)} | ${pair((x) => x.count80)} | ${pair((x) => x.maxOvr)} | ${pair((x) => x.god, 2)} | ${pair((x) => x.meanDelta, 2)} |`);
  });
  lines.push("", "Mean script ΔOVR by age, all seasons:", "");
  lines.push(`| Age | ${base ? `${base.name} | ` : ""}${name} |`, `|---|${base ? "---|" : ""}---|`);
  for (const [band, v] of Object.entries(a.ageCurve)) lines.push(`| ${band} | ${base ? `${sign(base.analysis.ageCurve[band] ?? 0)} | ` : ""}${sign(v)} |`);
  lines.push("", "± is one standard error across replicates. Seasons after the first use StatGen stats, not BBGM's game sim; see the manifest for the model version and its calibration.", "");
  return lines.join("\n");
}
