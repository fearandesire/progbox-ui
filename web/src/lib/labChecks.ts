import type { LabCheckItem, LabChecks, LabDirection, LabMeta, LabRunDetails, LabRunListMeta } from "./labTypes";

/** The version part of a script id: net@3.2.1 -> 3.2.1. */
export function shortId(id: string): string {
  const at = id.indexOf("@");
  return at >= 0 ? id.slice(at + 1) : id;
}

/** Signed percent with a real minus sign: 68 -> "+68%", -3.66 -> "−3.7%", 4 -> "+4%". */
export function fmtPct(p: number | null | undefined): string {
  if (p === null || p === undefined || !Number.isFinite(p)) return "";
  const abs = Math.abs(p);
  const digits = abs < 10 ? 1 : 0;
  let body = abs.toFixed(digits);
  if (body.endsWith(".0")) body = body.slice(0, -2);
  if (Number(body) === 0) return "0%";
  return `${p > 0 ? "+" : "−"}${body}%`;
}

export const DIRECTION_LABEL: Record<LabDirection, string> = { better: "Better", worse: "Worse", same: "Same" };

/** Text for the Change column: "+68% worse", or just "Same" when there is no percent. */
export function changeText(item: LabCheckItem): string {
  const c = item.change;
  if (!c) return "–";
  const pct = fmtPct(c.pct);
  return pct ? `${pct} ${c.direction}` : DIRECTION_LABEL[c.direction];
}

export type CheckFilter = "all" | "fail" | "diff";

export function showCheck(item: LabCheckItem, f: CheckFilter): boolean {
  if (f === "all") return true;
  if (f === "fail") return item.script.pass === false;
  return !!item.change && item.change.direction !== "same";
}

export function filterCounts(checks: LabChecks): Record<CheckFilter, number> {
  return {
    all: checks.items.length,
    fail: checks.items.filter((c) => showCheck(c, "fail")).length,
    diff: checks.items.filter((c) => showCheck(c, "diff")).length,
  };
}

export type PassState = "pass" | "fail" | "na";

export function passState(v: { pass: boolean | null } | null | undefined): PassState {
  if (!v || v.pass === null) return "na";
  return v.pass ? "pass" : "fail";
}

/** Checks the baseline passes that the script fails. */
export function brokenChecks(checks: LabChecks): LabCheckItem[] {
  return checks.items.filter((c) => c.baseline?.pass === true && c.script.pass === false);
}

/** Worse / Better / Same rows under the verdict, in that order, skipping empty groups. */
export function moveGroups(checks: LabChecks): { direction: LabDirection; items: LabCheckItem[] }[] {
  const order: LabDirection[] = ["worse", "better", "same"];
  return order
    .map((direction) => ({ direction, items: checks.items.filter((c) => c.change?.direction === direction) }))
    .filter((g) => g.items.length > 0);
}

export interface VerdictText {
  tone: "good" | "bad" | "neutral";
  title: string;
  line: string;
}

export function verdictText(checks: LabChecks, scriptId: string, baselineId: string | null): VerdictText {
  const s = checks.script;
  const plural = (n: number) => (n === 1 ? "check" : "checks");
  if (!checks.baseline || !baselineId || checks.verdict === null) {
    const all = s.passed === s.applicable;
    return {
      tone: all ? "good" : "neutral",
      title: `${scriptId} passes ${s.passed} of ${s.applicable} ${plural(s.applicable)}`,
      line: "No comparison script, so there is no verdict. Pick one under Compare against to get Better, Worse or Mixed.",
    };
  }
  const b = checks.baseline;
  const broken = brokenChecks(checks).length;
  const breaks = broken ? `breaks ${broken} that ${baselineId} passes` : `breaks none that ${baselineId} passes`;
  if (checks.verdict === "worse") {
    return { tone: "bad", title: `Worse than ${baselineId}`, line: `Passes fewer checks and ${breaks}.` };
  }
  if (checks.verdict === "better") {
    return { tone: "good", title: `Better than ${baselineId}`, line: `Passes ${s.passed} of ${s.applicable} to ${b.passed} of ${b.applicable} and ${breaks}.` };
  }
  return { tone: "neutral", title: `Mixed against ${baselineId}`, line: `Passes ${s.passed} of ${s.applicable} to ${b.passed} of ${b.applicable} and ${breaks}.` };
}

export function checkAnchor(id: string): string {
  return `check-${id}`;
}

/** Rows for the Run details panel. Missing pieces are left out rather than shown blank. */
export function runDetailRows(details: LabRunDetails | null | undefined, lab: LabMeta | null | undefined): [string, string][] {
  const rows: [string, string][] = [];
  const sha = (s: string) => `${s.slice(0, 8)}…`;
  if (details) {
    rows.push(["NET runs", details.netRuns]);
    rows.push(["Games", details.gamesSimulated ? "Simulated (StatGen, fit to BBGM output)" : "None played"]);
    rows.push(["Stats NET read", details.statsRead]);
    rows.push(["League", details.league.name]);
    rows.push(["Runs", `${details.runs.toLocaleString("en-US")}, seed ${details.seed}`]);
    const scripts = details.scripts.map((s) => `${s.id} ${sha(s.sha256)}`);
    if (details.pre) scripts.push(details.pre.id);
    rows.push(["Scripts", scripts.join(", ")]);
  }
  if (lab) {
    rows.push(["NET Lab", lab.commit ? `${lab.version}, commit ${lab.commit}` : lab.version]);
    rows.push(["Checks", `checks v${lab.checks.version}, rules ${sha(lab.checks.rulesSha256)}`]);
    rows.push(["StatGen", lab.statgen ?? "Not used"]);
  }
  return rows;
}

/** "0.3.0" with the checks version in a tooltip, from either History shape. */
export function labVersionText(lab: LabRunListMeta | null | undefined): { text: string; title: string } {
  if (!lab?.version) return { text: "–", title: "Made before NET Lab recorded its version" };
  const cv = lab.checksVersion ?? (typeof lab.checks === "number" ? lab.checks : lab.checks?.version);
  return { text: lab.version, title: cv !== undefined && cv !== null ? `NET Lab ${lab.version}, checks v${cv}` : `NET Lab ${lab.version}` };
}
