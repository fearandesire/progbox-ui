import { createHash } from "node:crypto";

/**
 * Balance checks: seven pass rules that say whether a script keeps a league
 * sane, and a verdict that compares a script with its baseline.
 *
 * Any edit to RULES changes rulesSha256, which every run records. When a rule
 * changes, bump CHECKS_VERSION and add a line to lab/CHANGELOG.md saying what
 * changed and why; `pnpm lab regrade <run>` then shows old runs under the new rules.
 */
export const CHECKS_VERSION = 1;

export const RULES = {
  /** League average OVR after the run stays within this many OVR of the start. */
  leagueOvrMaxDrift: 1.5,
  /** Players at 75+ OVR after the run: at most this multiple of the start. */
  starCountMaxRatio: 2,
  /** Players at 80+ OVR after the run: at most this many. */
  superstarsMax: 3,
  /** God progs (every rating but height up 7+) per offseason: at most this many. */
  godProgsMax: 1,
  /** OVR gained per 1 SD better PER, holding age and OVR fixed: at least this much. */
  productionMinEffect: 0.5,
  /** Median over players of the SD of their prog across seeds: at most this many OVR. */
  predictableMaxSd: 1.5,
  /** Mean OVR change at 25 to 27: at least this. */
  aging25to27Min: -0.5,
  /** Mean OVR change at 34+: at most this. */
  aging34PlusMax: -2,
  /** The league-level checks need a run of at least this many seasons. */
  multiSeasonMinSeasons: 10,
  /** Script vs baseline differences smaller than this many standard errors count as a tie. */
  tieSe: 2,
} as const;

export function rulesSha256(): string {
  return createHash("sha256").update(JSON.stringify({ version: CHECKS_VERSION, rules: RULES })).digest("hex");
}

export type CheckId = "league-ovr" | "star-count" | "superstars" | "god-progs" | "production" | "predictable" | "aging";
export type Direction = "better" | "worse" | "same";
export type CheckValue = { value: number | number[]; display: string; pass: boolean | null; pctFromStart: number | null };
export type CheckItem = {
  id: CheckId;
  name: string;
  unit: string;
  rule: string;
  applicable: boolean;
  script: CheckValue | null;
  baseline: CheckValue | null;
  noScript: { value: number | number[]; display: string } | null;
  change: { pct: number | null; direction: Direction; note: string } | null;
};
export type Checks = {
  version: number;
  rulesSha256: string;
  verdict: "better" | "worse" | "mixed" | null;
  script: { passed: number; applicable: number };
  baseline: { passed: number; applicable: number } | null;
  items: CheckItem[];
};

type Stat = { mean: number; se: number };
/** What one script (or the no-script reference) measured. Built from report.json, so regrade uses the same path. */
export type SideInput = {
  quick: {
    runs: number;
    godProgsPerRun: number;
    godProgsSe?: number;
    medianPlayerSd: number;
    perEffect: number | null;
    perEffectSe?: number | null;
    deltaByAge: Record<string, { meanDelta: number; se?: number }>;
  } | null;
  deep: {
    seasons: { leagueMeanOvr: Stat; count75: Stat; count80: Stat; god: Stat }[];
    ageCurve: Record<string, number>;
    ageCurveSe?: Record<string, number>;
  } | null;
};
export type CheckInput = {
  /** The league before the run's first offseason (active players). */
  start: { leagueMeanOvr: number; count75: number; count80: number } | null;
  /** Seasons the deep part played (0 for quick mode). */
  seasons: number;
  script: SideInput;
  baseline: SideInput | null;
  noScript: SideInput | null;
};

const M = "−";
const num = (x: number, d: number, signed = false) => {
  const s = Math.abs(x).toFixed(d);
  if (Number(s) === 0) return (0).toFixed(d);
  return x < 0 ? `${M}${s}` : signed ? `+${s}` : s;
};

/** One measured value: parts drive the tie test, primary drives % change, badness > 0 means it fails by that much. */
type Measure = { value: number | number[]; display: string; pass: boolean; pctFromStart: number | null; parts: Stat[]; primary: number; badness: number };

type Def = {
  id: CheckId;
  name: string;
  unit: string;
  rule: string;
  multiSeason?: boolean;
  /** No-script reference values make sense for this check. */
  noScript?: boolean;
  measure: (side: SideInput, input: CheckInput) => Measure | null;
  note: (s: number, b: number) => string;
};

const lastSeason = (side: SideInput) => side.deep?.seasons.at(-1) ?? null;
const ageOf = (side: SideInput, band: string): Stat | null => {
  if (side.deep && band in side.deep.ageCurve) return { mean: side.deep.ageCurve[band]!, se: side.deep.ageCurveSe?.[band] ?? 0 };
  const q = side.quick?.deltaByAge[band];
  return q ? { mean: q.meanDelta, se: q.se ?? 0 } : null;
};
const more = (s: number, b: number, up: string, down: string) => (s > b ? up : down);

const DEFS: Def[] = [
  {
    id: "league-ovr",
    name: "League average OVR holds",
    unit: "OVR change over 10 seasons",
    rule: `within ${RULES.leagueOvrMaxDrift} OVR of the start`,
    multiSeason: true,
    noScript: true,
    measure: (side, { start }) => {
      const last = lastSeason(side);
      if (!last || !start) return null;
      const v = last.leagueMeanOvr.mean - start.leagueMeanOvr;
      return { value: v, display: num(v, 1, true), pass: Math.abs(v) <= RULES.leagueOvrMaxDrift, pctFromStart: (100 * v) / start.leagueMeanOvr, parts: [{ mean: v, se: last.leagueMeanOvr.se }], primary: v, badness: Math.abs(v) - RULES.leagueOvrMaxDrift };
    },
    note: (s, b) => (s < 0 && b < 0 ? more(-s, -b, "more decline", "less decline") : s > 0 && b > 0 ? more(s, b, "more growth", "less growth") : more(Math.abs(s), Math.abs(b), "bigger drift", "smaller drift")),
  },
  {
    id: "star-count",
    name: "Star count stays sane",
    unit: "players at 75+ OVR, start → season 10",
    rule: RULES.starCountMaxRatio === 2 ? "at most double the start" : `at most ${RULES.starCountMaxRatio} times the start`,
    multiSeason: true,
    noScript: true,
    measure: (side, { start }) => {
      const last = lastSeason(side);
      if (!last || !start) return null;
      const end = last.count75.mean;
      const limit = RULES.starCountMaxRatio * start.count75;
      return { value: [start.count75, end], display: `${num(start.count75, Number.isInteger(start.count75) ? 0 : 1)} → ${num(end, 1)}`, pass: end <= limit, pctFromStart: start.count75 ? (100 * (end - start.count75)) / start.count75 : null, parts: [last.count75], primary: end, badness: end - limit };
    },
    note: (s, b) => more(s, b, "more 75+ players", "fewer 75+ players"),
  },
  {
    id: "superstars",
    name: "Superstars stay rare",
    unit: "players at 80+ OVR in season 10",
    rule: `${RULES.superstarsMax} or fewer`,
    multiSeason: true,
    noScript: true,
    measure: (side) => {
      const last = lastSeason(side);
      if (!last) return null;
      const v = last.count80.mean;
      return { value: v, display: num(v, 1), pass: v <= RULES.superstarsMax, pctFromStart: null, parts: [last.count80], primary: v, badness: v - RULES.superstarsMax };
    },
    note: (s, b) => more(s, b, "more 80+", "fewer 80+"),
  },
  {
    id: "god-progs",
    name: "God progs stay rare",
    unit: "per offseason",
    rule: `${RULES.godProgsMax} or fewer`,
    noScript: true,
    measure: (side) => {
      let g: Stat | null = null;
      if (side.quick) g = { mean: side.quick.godProgsPerRun, se: side.quick.godProgsSe ?? Math.sqrt(side.quick.godProgsPerRun / Math.max(1, side.quick.runs)) };
      else if (side.deep?.seasons.length) {
        const ss = side.deep.seasons;
        g = { mean: ss.reduce((a, s) => a + s.god.mean, 0) / ss.length, se: Math.sqrt(ss.reduce((a, s) => a + s.god.se ** 2, 0)) / ss.length };
      }
      if (!g) return null;
      return { value: g.mean, display: num(g.mean, 1), pass: g.mean <= RULES.godProgsMax, pctFromStart: null, parts: [g], primary: g.mean, badness: g.mean - RULES.godProgsMax };
    },
    note: (s, b) => (b > 0 && s / b >= 2 ? `${(s / b).toFixed(1)} times as many` : b > 0 && s > 0 && b / s >= 2 ? `${(b / s).toFixed(1)} times fewer` : more(s, b, "more god progs", "fewer god progs")),
  },
  {
    id: "production",
    name: "Production drives progs",
    unit: "OVR gained per 1 SD better PER",
    rule: `+${RULES.productionMinEffect} OVR or more`,
    measure: (side) => {
      const v = side.quick?.perEffect;
      if (v === null || v === undefined) return null;
      return { value: v, display: num(v, 2, true), pass: v >= RULES.productionMinEffect, pctFromStart: null, parts: [{ mean: v, se: side.quick!.perEffectSe ?? 0 }], primary: v, badness: RULES.productionMinEffect - v };
    },
    note: (s, b) => more(s, b, "stronger link to PER", "weaker link to PER"),
  },
  {
    id: "predictable",
    name: "Progs are predictable",
    unit: "spread of a typical player's prog, OVR",
    rule: `${RULES.predictableMaxSd} OVR or less`,
    measure: (side) => {
      const q = side.quick;
      if (!q || !q.runs) return null;
      const v = q.medianPlayerSd;
      // A sample SD from n runs has SE ≈ SD / sqrt(2(n-1)).
      return { value: v, display: num(v, 2), pass: v <= RULES.predictableMaxSd, pctFromStart: null, parts: [{ mean: v, se: v / Math.sqrt(2 * Math.max(1, q.runs - 1)) }], primary: v, badness: v - RULES.predictableMaxSd };
    },
    note: (s, b) => more(s, b, "more spread", "less spread"),
  },
  {
    id: "aging",
    name: "Players age normally",
    unit: "mean OVR change, ages 25 to 27 / 34+",
    rule: `25 to 27 at ${num(RULES.aging25to27Min, 1)} or better, 34+ at ${num(RULES.aging34PlusMax, 0)} or worse`,
    measure: (side) => {
      const young = ageOf(side, "25-27");
      const old = ageOf(side, "34+");
      if (!young || !old) return null;
      const pass = young.mean >= RULES.aging25to27Min && old.mean <= RULES.aging34PlusMax;
      return { value: [young.mean, old.mean], display: `${num(young.mean, 2, true)} / ${num(old.mean, 2, true)}`, pass, pctFromStart: null, parts: [young, old], primary: old.mean, badness: Math.max(RULES.aging25to27Min - young.mean, old.mean - RULES.aging34PlusMax) };
    },
    note: (s, b) => more(-s, -b, "steeper 34+ decline", "gentler 34+ decline"),
  },
];

export const CHECK_DEFS = DEFS.map(({ id, name, unit, rule, multiSeason }) => ({ id, name, unit, rule, multiSeason: !!multiSeason }));

const asValue = (m: Measure | null): CheckValue | null => (m ? { value: m.value, display: m.display, pass: m.pass, pctFromStart: m.pctFromStart } : null);

function compare(def: Def, s: Measure, b: Measure): NonNullable<CheckItem["change"]> {
  const tie = s.parts.every((p, i) => {
    const q = b.parts[i]!;
    const se = Math.sqrt(p.se ** 2 + q.se ** 2);
    return Math.abs(p.mean - q.mean) < Math.max(RULES.tieSe * se, 1e-9);
  });
  // Relative difference in size: -2.3 vs -1.4 is 63% more decline, +0.35 vs +1.23 is 72% less effect.
  const pct = b.primary !== 0 ? (100 * (Math.abs(s.primary) - Math.abs(b.primary))) / Math.abs(b.primary) : null;
  let direction: Direction;
  if (tie) direction = "same";
  else if (s.pass !== b.pass) direction = s.pass ? "better" : "worse";
  else if (s.pass) direction = "same";
  else direction = s.badness < b.badness ? "better" : s.badness > b.badness ? "worse" : "same";
  const base = tie ? "within noise" : def.note(s.primary, b.primary);
  const suffix = s.pass && b.pass ? ", both pass" : !s.pass && !b.pass ? (direction === "better" ? ", still fails" : ", both fail") : "";
  return { pct, direction, note: base + suffix };
}

export function gradeChecks(input: CheckInput): Checks {
  const multi = input.seasons >= RULES.multiSeasonMinSeasons;
  const items: CheckItem[] = DEFS.map((def) => {
    const applicable = !def.multiSeason || multi;
    const s = applicable ? def.measure(input.script, input) : null;
    const b = applicable && input.baseline ? def.measure(input.baseline, input) : null;
    const n = applicable && def.noScript && input.noScript ? def.measure(input.noScript, input) : null;
    return {
      id: def.id,
      name: def.name,
      unit: def.unit,
      rule: def.rule,
      applicable,
      script: asValue(s),
      baseline: asValue(b),
      noScript: n ? { value: n.value, display: n.display } : null,
      change: s && b ? compare(def, s, b) : null,
    };
  });
  const graded = (side: "script" | "baseline") => {
    const xs = items.filter((i) => i.applicable && i[side]);
    return { passed: xs.filter((i) => i[side]!.pass).length, applicable: xs.length };
  };
  let verdict: Checks["verdict"] = null;
  if (input.baseline) {
    const paired = items.filter((i) => i.change);
    const breaks = paired.filter((i) => i.baseline!.pass && !i.script!.pass && i.change!.direction === "worse").length;
    const fixes = paired.filter((i) => !i.baseline!.pass && i.script!.pass && i.change!.direction === "better").length;
    // Ties (under 2 SE) neither break nor fix, so passes are counted as if tied checks matched the baseline.
    verdict = breaks === 0 ? "better" : fixes < breaks ? "worse" : "mixed";
  }
  return { version: CHECKS_VERSION, rulesSha256: rulesSha256(), verdict, script: graded("script"), baseline: input.baseline ? graded("baseline") : null, items };
}

/** One-line reason for the verdict, as the report heading's subtitle. */
export function verdictText(c: Checks, scriptId: string, baselineId: string | null): { title: string; text: string } {
  const pairs = c.items.filter((i) => i.change);
  const breaks = pairs.filter((i) => i.baseline!.pass && !i.script!.pass && i.change!.direction === "worse").length;
  const fixes = pairs.filter((i) => !i.baseline!.pass && i.script!.pass && i.change!.direction === "better").length;
  if (!c.verdict || !baselineId) return { title: `${scriptId} passes ${c.script.passed} of ${c.script.applicable} checks`, text: "No baseline, so there is no comparison." };
  const title = { better: `Better than ${baselineId}`, worse: `Worse than ${baselineId}`, mixed: `Mixed against ${baselineId}` }[c.verdict];
  const lead = c.script.passed < c.baseline!.passed ? "Passes fewer checks" : c.script.passed > c.baseline!.passed ? "Passes more checks" : "Passes as many checks";
  const broke = `breaks ${breaks || "none"} that ${baselineId} passes`;
  const fixed = `fixes ${fixes} that ${baselineId} fails`;
  const text = fixes ? (breaks ? `${lead}, ${broke} and ${fixed}.` : `${lead} and ${fixed}.`) : `${lead} and ${broke}.`;
  return { title, text };
}

/** Markdown for the top of summary.md: verdict, checks table. */
export function checksMarkdown(c: Checks, scriptId: string, baselineId: string | null): string {
  const { title, text } = verdictText(c, scriptId, baselineId);
  const lines = [`## ${title}`, "", text, ""];
  lines.push(`${scriptId}: ${c.script.passed}/${c.script.applicable} checks pass${c.baseline && baselineId ? ` · ${baselineId}: ${c.baseline.passed}/${c.baseline.applicable}` : ""}`, "");
  lines.push("## Balance checks", "");
  const mark = (v: CheckValue | null) => (v ? `${v.pass ? "✓" : "✗"} ${v.display}${v.pctFromStart !== null ? ` (${num(v.pctFromStart, Math.abs(v.pctFromStart) >= 10 ? 0 : 1, true)}%)` : ""}` : "n/a");
  const head = [`Check`, scriptId, ...(baselineId ? [baselineId] : []), "No script", ...(baselineId ? [`Change vs ${baselineId}`] : [])];
  lines.push(`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`);
  for (const i of c.items) {
    const name = `${i.name} (${i.unit}; passes: ${i.rule})`;
    if (!i.applicable) {
      lines.push(`| ${[name, "n/a", ...(baselineId ? ["n/a"] : []), "n/a", ...(baselineId ? ["needs a 10-season run"] : [])].join(" | ")} |`);
      continue;
    }
    const change = i.change ? `${i.change.pct === null ? "" : `${num(i.change.pct, 0, true)}% `}${i.change.direction}: ${i.change.note}` : "n/a";
    lines.push(`| ${[name, mark(i.script), ...(baselineId ? [mark(i.baseline)] : []), i.noScript?.display ?? "n/a", ...(baselineId ? [change] : [])].join(" | ")} |`);
  }
  lines.push("", `Gaps under ${RULES.tieSe} standard errors count as a tie. % in a value cell is its change from the start of the run. Rules: lab/src/verdict.ts (checks v${c.version}, rules ${c.rulesSha256.slice(0, 8)}).`, "");
  return lines.join("\n");
}
