import type { LabKpis, LabMode, LabRunDetail } from "./labTypes";

/** Series colors used on every lab chart: baseline blue, script orange. */
export const BASELINE_COLOR = "#2563eb";
export const SCRIPT_COLOR = "#ea580c";

/** Locked run sizes, mirrored from lab/src/presets.ts for display (lab.test.ts keeps them in sync). */
export const LAB_PRESETS = {
  quick: { runs: 1000 },
  deep: { seasons: 10, replicates: 200 },
  season: { seasons: 1, replicates: 200 },
} as const;

/** Short name of a run mode, as the New test cards say it. */
export function modeLabel(mode: string): string {
  if (mode === "deep") return "Every offseason, 10 seasons";
  if (mode === "season") return "After one season";
  if (mode === "quick") return "Right now";
  return mode;
}

export const DEFAULT_LEAGUE_ID = "nba-2025-26";

export const AGE_BANDS = ["25-27", "28-30", "31-33", "34+"] as const;

export const RATING_KEYS = ["hgt", "stre", "spd", "jmp", "endu", "ins", "dnk", "ft", "fg", "tp", "oiq", "diq", "drb", "pss", "reb"] as const;

export const STATGEN_NOTE = "Season 1 uses the export's real stats; every season after the first uses StatGen-generated stats.";

export function sgn(x: number | null | undefined, digits = 2): string {
  if (x === null || x === undefined || Number.isNaN(x)) return "–";
  const v = x.toFixed(digits);
  return x > 0 ? `+${v}` : v;
}

export function num(x: number | null | undefined, digits = 1): string {
  if (x === null || x === undefined || Number.isNaN(x)) return "–";
  return x.toFixed(digits);
}

/** Rounded integer text without a "-0". */
export function int(x: number): string {
  const r = Math.round(x);
  return String(r === 0 ? 0 : r);
}

export function secondsText(s: number | null | undefined): string {
  if (s === null || s === undefined || !Number.isFinite(s)) return "–";
  const t = Math.max(0, Math.round(s));
  if (t < 60) return `${t}s`;
  const m = Math.floor(t / 60);
  const r = t % 60;
  if (m < 60) return `${m}m ${String(r).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

export function verdictClass(v: string | null | undefined): "good" | "warn" | "bad" | "neutral" {
  if (v === "No flags") return "good";
  if (v === "Hold") return "bad";
  if (v === "Review flags") return "warn";
  return "neutral";
}

export function sizeText(mode: LabMode, unlock?: { runs?: number; seasons?: number; replicates?: number } | null): string {
  const runs = unlock?.runs ?? LAB_PRESETS.quick.runs;
  if (mode === "quick") return `${runs} offseasons`;
  const preset = mode === "season" ? LAB_PRESETS.season : LAB_PRESETS.deep;
  const reps = unlock?.replicates ?? preset.replicates;
  const seasons = unlock?.seasons ?? preset.seasons;
  return `${reps} replicates × ${seasons} season${seasons === 1 ? "" : "s"}, plus ${runs} single offseasons`;
}

/** The CLI's stage ids in the order it runs them, for the progress checklist. */
export function expectedStages(run: Pick<LabRunDetail, "mode" | "script" | "baseline">): { stage: string; label: string }[] {
  const list = [{ stage: "ingest", label: "Check the league" }];
  const sides = [run.script, ...(run.baseline ? [run.baseline] : [])];
  for (const s of sides) list.push({ stage: `quick:${s}`, label: `${s}: single offseasons` });
  if (run.mode !== "quick") for (const s of sides) list.push({ stage: `deep:${s}`, label: `${s}: multi-season replicates` });
  list.push({ stage: "report", label: "Write the report" });
  return list;
}

export type KpiRow = { label: string; fmt: (k: LabKpis) => string };

export const KPI_ROWS: KpiRow[] = [
  { label: "Players progressed per offseason", fmt: (k) => k.progressedPerRun.toFixed(0) },
  { label: "Mean ΔOVR", fmt: (k) => sgn(k.meanDelta) },
  { label: "SD of ΔOVR", fmt: (k) => k.sdDelta.toFixed(2) },
  { label: "Median per-player SD", fmt: (k) => k.medianPlayerSd.toFixed(2) },
  { label: "% up / % down", fmt: (k) => `${Math.round(k.pctPositive * 100)}% / ${Math.round(k.pctNegative * 100)}%` },
  { label: "God progs per offseason", fmt: (k) => k.godProgsPerRun.toFixed(2) },
  { label: "80+ OVR players before → after", fmt: (k) => `${num(k.over80Before)} → ${num(k.over80After)}` },
  { label: "P99 OVR after", fmt: (k) => k.p99OvrAfter.toFixed(1) },
  { label: "PER effect (ΔOVR per SD)", fmt: (k) => num(k.perEffect, 2) },
  { label: "BPM effect (ΔOVR per SD)", fmt: (k) => num(k.bpmEffect, 2) },
  { label: "Failed runs / invalid rows", fmt: (k) => `${k.failedRuns} / ${k.invalidRows}` },
];

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
