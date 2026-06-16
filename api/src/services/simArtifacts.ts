import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { outputsRoot } from "../paths.js";

export class InvalidChartNameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidChartNameError";
  }
}

export class ArtifactNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArtifactNotFoundError";
  }
}

function rawDir(build: string): string {
  return path.join(outputsRoot(), build, "raw");
}

function outputsCsvPath(build: string): string {
  return path.join(rawDir(build), "outputs.csv");
}

export type OutputRow = Record<string, string | number | boolean | null>;

export function loadOutputsDf(build: string): OutputRow[] {
  const p = outputsCsvPath(build);
  if (!fs.existsSync(p)) {
    throw new Error(`outputs.csv not found: ${p}`);
  }
  const text = fs.readFileSync(p, "utf8");
  const rows = parse(text, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
  }) as Record<string, string>[];

  if (rows.length === 0) return [];
  const first = rows[0];
  const cols = Object.keys(first);
  if (cols.includes("Unnamed: 0")) {
    return rows.map((r) => {
      const { ["Unnamed: 0"]: _u, ...rest } = r;
      return coerceRow(rest);
    });
  }
  return rows.map((r) => coerceRow(r));
}

function coerceRow(r: Record<string, string>): OutputRow {
  const out: OutputRow = {};
  for (const [k, v] of Object.entries(r)) {
    if (v === "" || v === null || v === undefined) {
      out[k] = null;
      continue;
    }
    const n = Number(v);
    if (!Number.isNaN(n) && v.trim() !== "" && /^-?\d/.test(v.trim())) {
      out[k] = n;
    } else if (v === "True" || v === "true") {
      out[k] = true;
    } else if (v === "False" || v === "false") {
      out[k] = false;
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** Pandas default sample std (ddof=1); single element → NaN treated as NaN in JSON we skip */
function sampleStd(values: number[]): number {
  const n = values.length;
  if (n < 2) return Number.NaN;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const v =
    values.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1);
  return Math.sqrt(v);
}

/** Type-7 quantile (linear), h = (n-1)*q */
function quantile(sorted: number[], q: number): number {
  const n = sorted.length;
  if (n === 0) return Number.NaN;
  if (n === 1) return sorted[0]!;
  const index = (n - 1) * q;
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  const h = index - lo;
  return sorted[lo]! * (1 - h) + sorted[hi]! * h;
}

function quantileSeries(values: number[]): { p05: number; p25: number; p50: number; p75: number; p95: number } {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    p05: quantile(sorted, 0.05),
    p25: quantile(sorted, 0.25),
    p50: quantile(sorted, 0.5),
    p75: quantile(sorted, 0.75),
    p95: quantile(sorted, 0.95),
  };
}

export function playerSummaries(build: string): Record<string, unknown>[] {
  const df = loadOutputsDf(build);
  const byPlayer = new Map<string | number, OutputRow[]>();
  for (const row of df) {
    const pid = row.PlayerID;
    if (pid === undefined || pid === null) continue;
    const key = typeof pid === "number" ? pid : String(pid);
    if (!byPlayer.has(key)) byPlayer.set(key, []);
    byPlayer.get(key)!.push(row);
  }

  const keys = [...byPlayer.keys()].sort((a, b) => {
    const na = typeof a === "number" ? a : Number(a);
    const nb = typeof b === "number" ? b : Number(b);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
    return String(a).localeCompare(String(b));
  });

  const out: Record<string, unknown>[] = [];
  for (const k of keys) {
    const rows = byPlayer.get(k)!;
    const first = rows[0]!;
    const name = String(first.Name ?? "");
    const team = String(first.Team ?? "");
    const age = Number(first.Age ?? 0);
    const baseline = Number(first.Baseline ?? 0);
    const deltas = rows.map((r) => Number(r.Delta ?? 0));
    const ovrs = rows.map((r) => Number(r.Ovr ?? 0));
    const q = quantileSeries(ovrs);
    const meanDelta = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    const stdDelta = sampleStd(deltas);
    out.push({
      PlayerID: first.PlayerID,
      Name: name,
      Team: team,
      Age: age,
      Baseline: baseline,
      MeanDelta: round4(meanDelta),
      StdDelta: round4(stdDelta),
      P05: round4(q.p05),
      P25: round4(q.p25),
      P50: round4(q.p50),
      P75: round4(q.p75),
      P95: round4(q.p95),
    });
  }
  return out;
}

function round4(x: number): number {
  if (Number.isNaN(x)) return x;
  return Math.round(x * 10000) / 10000;
}

export function playerAllRuns(build: string, pid: string): Record<string, unknown>[] {
  const df = loadOutputsDf(build);
  const sub = df.filter((r) => String(r.PlayerID) === String(pid));
  return sub.map((r) => {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) {
      if (typeof v === "number" && Number.isFinite(v)) {
        o[k] = round4(v);
      } else {
        o[k] = v;
      }
    }
    return o;
  });
}

const SEVERE_REGRESSION_THRESHOLD = -2.0;

export interface RunAggregateStats {
  god_progs: number | null;
  mean_delta: number | null;
  severe_regressions: number | null;
}

const NULL_RUN_STATS: RunAggregateStats = {
  god_progs: null,
  mean_delta: null,
  severe_regressions: null,
};

/** League-wide aggregates for metadata persistence and list views. */
export function computeRunStats(build: string): RunAggregateStats {
  try {
    const players = playerSummaries(build);
    const godprogs = godprogsRecords(build);
    const deltas = players.map((p) => Number(p.MeanDelta ?? 0));
    const meanDelta = deltas.length
      ? deltas.reduce((a, b) => a + b, 0) / deltas.length
      : null;
    return {
      god_progs: godprogs.length,
      mean_delta: meanDelta !== null ? round4(meanDelta) : null,
      severe_regressions: players.filter(
        (p) => Number(p.MeanDelta ?? 0) <= SEVERE_REGRESSION_THRESHOLD,
      ).length,
    };
  } catch {
    return { ...NULL_RUN_STATS };
  }
}

export function godprogsRecords(build: string): Record<string, unknown>[] {
  const p = path.join(rawDir(build), "godprogs.json");
  if (!fs.existsSync(p) || fs.statSync(p).size <= 2) {
    return [];
  }
  try {
    const data = JSON.parse(fs.readFileSync(p, "utf8"));
    if (!Array.isArray(data)) return [];
    return data as Record<string, unknown>[];
  } catch {
    return [];
  }
}

export function listChartFilenames(build: string): string[] {
  const charts = path.join(outputsRoot(), build, "charts");
  if (!fs.existsSync(charts) || !fs.statSync(charts).isDirectory()) {
    return [];
  }
  return fs
    .readdirSync(charts)
    .filter((n) => n.endsWith(".png"))
    .sort();
}

export function chartPath(build: string, name: string): string {
  const base = path.resolve(path.join(outputsRoot(), build, "charts"));
  if (
    !name ||
    name === "." ||
    name === ".." ||
    path.posix.basename(name) !== name ||
    path.win32.basename(name) !== name
  ) {
    throw new InvalidChartNameError("Invalid chart name");
  }
  const target = path.resolve(path.join(base, name));
  const rel = path.relative(base, target);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new InvalidChartNameError("Invalid chart name");
  }
  if (!fs.existsSync(target)) {
    throw new ArtifactNotFoundError("Chart not found");
  }
  return target;
}

export function analysisXlsxPath(build: string): string {
  return path.join(outputsRoot(), build, "analysis.xlsx");
}

export function rawOutputsCsvPath(build: string): string {
  return outputsCsvPath(build);
}

export function analysisDashboardPath(build: string): string {
  return path.join(outputsRoot(), build, "analysis_dashboard.html");
}
