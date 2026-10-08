import fs from "node:fs";
import path from "node:path";
import { RATING_KEYS } from "./compat.ts";
import type { Analysis, Kpis, PlayerSummary } from "./analyze.ts";

export type Flag = { level: "error" | "warn"; text: string };

const f1 = (x: number | null) => (x === null ? "n/a" : x.toFixed(1));
const f2 = (x: number | null) => (x === null ? "n/a" : x.toFixed(2));
const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
const sign = (x: number) => (x > 0 ? `+${x.toFixed(2)}` : x.toFixed(2));

/**
 * Heuristic flags for a quick read. They point at things to look at; they are not release gates.
 * Thresholds are deliberately loose and listed in the report so a reader can judge them.
 */
export function flagsFor(a: Analysis, base?: Analysis): Flag[] {
  const flags: Flag[] = [];
  const k = a.kpis;
  if (k.failedRuns) flags.push({ level: "error", text: `${k.failedRuns}/${k.runs} runs failed: ${a.errors[0]!.name}: ${a.errors[0]!.message}` });
  if (k.invalidRows) flags.push({ level: "error", text: `${k.invalidRows} progressed rows hold NaN, fractional or out-of-range ratings.` });
  if (!k.progressedPerRun && !k.failedRuns) flags.push({ level: "error", text: "The script progressed nobody. Check watch flags, phase and the pre-progs hook." });
  if (k.perEffect !== null && k.perEffect <= 0) flags.push({ level: "warn", text: `Higher PER does not raise progs (effect ${f2(k.perEffect)} OVR per SD).` });
  if (base) {
    const b = base.kpis;
    if (k.meanDelta - b.meanDelta > 1) flags.push({ level: "warn", text: `Mean ΔOVR is ${sign(k.meanDelta - b.meanDelta)} vs baseline: league inflation risk.` });
    if (b.meanDelta - k.meanDelta > 1) flags.push({ level: "warn", text: `Mean ΔOVR is ${sign(k.meanDelta - b.meanDelta)} vs baseline: league deflation risk.` });
    if (k.over80After > Math.max(b.over80After * 1.5, b.over80After + 2)) flags.push({ level: "warn", text: `80+ OVR players after progs: ${f1(k.over80After)} vs ${f1(b.over80After)} on baseline.` });
    if (k.godProgsPerRun > Math.max(2 * b.godProgsPerRun, b.godProgsPerRun + 1)) flags.push({ level: "warn", text: `God progs per offseason: ${f2(k.godProgsPerRun)} vs ${f2(b.godProgsPerRun)}.` });
    if (k.medianPlayerSd > 1.5 * b.medianPlayerSd && k.medianPlayerSd - b.medianPlayerSd > 0.5) flags.push({ level: "warn", text: `Progs are much noisier: median per-player SD ${f2(k.medianPlayerSd)} vs ${f2(b.medianPlayerSd)}.` });
  }
  return flags;
}

export function verdictOf(flags: Flag[]): "Hold" | "Review flags" | "No flags" {
  if (flags.some((f) => f.level === "error")) return "Hold";
  return flags.length ? "Review flags" : "No flags";
}

const KPI_ROWS: [string, (k: Kpis) => string][] = [
  ["Players progressed per offseason", (k) => f1(k.progressedPerRun)],
  ["Mean ΔOVR", (k) => sign(k.meanDelta)],
  ["ΔOVR SD (all player-runs)", (k) => f2(k.sdDelta)],
  ["Median per-player SD", (k) => f2(k.medianPlayerSd)],
  ["% up / % down", (k) => `${pct(k.pctPositive)} / ${pct(k.pctNegative)}`],
  ["ΔOVR age 25-27", (k) => sign(k.deltaByAge["25-27"]?.meanDelta ?? 0)],
  ["ΔOVR age 28-30", (k) => sign(k.deltaByAge["28-30"]?.meanDelta ?? 0)],
  ["ΔOVR age 31-33", (k) => sign(k.deltaByAge["31-33"]?.meanDelta ?? 0)],
  ["ΔOVR age 34+", (k) => sign(k.deltaByAge["34+"]?.meanDelta ?? 0)],
  ["God progs per offseason", (k) => f2(k.godProgsPerRun)],
  ["80+ OVR players (before → after)", (k) => `${k.over80Before} → ${f1(k.over80After)}`],
  ["P99 OVR after", (k) => f1(k.p99OvrAfter)],
  ["PER effect (ΔOVR per SD)", (k) => f2(k.perEffect)],
  ["BPM effect (ΔOVR per SD)", (k) => f2(k.bpmEffect)],
];

function playerLine(p: PlayerSummary): string {
  return `| ${p.name} | ${p.age} | ${f1(p.per)} | ${p.baseOvr} | ${sign(p.meanDelta)} | ${p.q10.toFixed(0)} to ${p.q90.toFixed(0)} | ${pct(p.godRate)} |`;
}

export function summaryMarkdown(opts: {
  title: string;
  a: Analysis;
  base?: { name: string; analysis: Analysis };
  scriptName: string;
  boundaryText: string;
  flags: Flag[];
}): string {
  const { a, base, flags } = opts;
  const lines: string[] = [];
  lines.push(`# ${opts.title}`, "");
  lines.push(`**${verdictOf(flags)}** · ${opts.scriptName}${base ? ` vs ${base.name}` : ""} · ${a.kpis.runs} offseasons · ${opts.boundaryText}`, "");
  if (flags.length) {
    lines.push("## Flags", "");
    for (const f of flags) lines.push(`- ${f.level === "error" ? "**Error:**" : "Watch:"} ${f.text}`);
    lines.push("");
  }
  lines.push("## Headline numbers", "");
  if (base) {
    lines.push(`| KPI | ${base.name} | ${opts.scriptName} |`, "|---|---|---|");
    for (const [label, fn] of KPI_ROWS) lines.push(`| ${label} | ${fn(base.analysis.kpis)} | ${fn(a.kpis)} |`);
  } else {
    lines.push(`| KPI | ${opts.scriptName} |`, "|---|---|");
    for (const [label, fn] of KPI_ROWS) lines.push(`| ${label} | ${fn(a.kpis)} |`);
  }
  lines.push("");
  const header = ["| Player | Age | PER | Base OVR | Mean Δ | Δ p10 to p90 | God % |", "|---|---|---|---|---|---|---|"];
  lines.push("## Biggest risers", "", ...header, ...a.players.slice(0, 5).map(playerLine), "");
  lines.push("## Biggest fallers", "", ...header, ...a.players.slice(-5).reverse().map(playerLine), "");
  const volatile = [...a.players].sort((x, y) => y.sdDelta - x.sdDelta).slice(0, 5);
  lines.push("## Most volatile", "", ...header, ...volatile.map(playerLine), "");
  if (base) {
    const other = new Map(base.analysis.players.map((p) => [p.pid, p]));
    const diffs = a.players
      .filter((p) => other.has(p.pid))
      .map((p) => ({ p, d: p.meanDelta - other.get(p.pid)!.meanDelta }))
      .sort((x, y) => Math.abs(y.d) - Math.abs(x.d))
      .slice(0, 8);
    lines.push(`## Players the two scripts treat most differently`, "", `| Player | Age | PER | ${base.name} mean Δ | ${opts.scriptName} mean Δ | Difference |`, "|---|---|---|---|---|---|");
    for (const { p, d } of diffs) lines.push(`| ${p.name} | ${p.age} | ${f1(p.per)} | ${sign(other.get(p.pid)!.meanDelta)} | ${sign(p.meanDelta)} | ${sign(d)} |`);
    lines.push("");
  }
  lines.push("## Notes", "");
  lines.push("- Quick mode: one offseason on this export, many seeds. Stats are the export's own; only the script's randomness varies.");
  lines.push("- Flags are heuristics for where to look, not release gates. Thresholds live in `lab/src/report.ts`.");
  lines.push("- PER/BPM effects are OLS coefficients on each player's mean ΔOVR, holding age and base OVR fixed.");
  lines.push("- God progs are counted as every rating except height rising by 7 or more.");
  return lines.join("\n") + "\n";
}

export function playersCsv(players: PlayerSummary[]): string {
  const cols = ["pid", "name", "tid", "age", "per", "bpm", "baseOvr", "runs", "meanOvr", "meanDelta", "sdDelta", "min", "q10", "median", "q90", "max", "pctPositive", "godRate"] as const;
  const esc = (v: unknown) => (typeof v === "string" && /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : String(v ?? ""));
  const rows = [[...cols, ...RATING_KEYS.map((k) => `d_${k}`)].join(",")];
  for (const p of players) {
    rows.push([...cols.map((c) => (typeof p[c] === "number" ? Number((p[c] as number).toFixed(4)) : p[c])), ...RATING_KEYS.map((k) => p.attrDelta[k]!.toFixed(4))].map(esc).join(","));
  }
  return rows.join("\n") + "\n";
}

export function writeJson(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}
