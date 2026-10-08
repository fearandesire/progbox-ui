import { describe, expect, it } from "vitest";
import { diffLines } from "./diff.ts";
import { runDetailsFor, seasonLabel } from "./lab.ts";
import type { Entry } from "./registry.ts";
import { CHECKS_VERSION, gradeChecks, RULES, rulesSha256, verdictText, type CheckInput, type SideInput } from "./verdict.ts";

const stat = (mean: number, se = 0) => ({ mean, se });
type Shape = { ovr10: number; c75: number; c80: number; god: number; per: number; sd: number; age: [number, number]; se?: number };
/** A side shaped like report.json, from the headline numbers of a 10-season run. */
function side(x: Shape): SideInput {
  const se = x.se ?? 0.01;
  return {
    quick: { runs: 1000, godProgsPerRun: x.god, godProgsSe: se, medianPlayerSd: x.sd, perEffect: x.per, perEffectSe: se, deltaByAge: {} },
    deep: {
      seasons: Array.from({ length: 10 }, (_, i) => ({ leagueMeanOvr: stat(i === 9 ? x.ovr10 : 52, se), count75: stat(i === 9 ? x.c75 : 2, se), count80: stat(i === 9 ? x.c80 : 0, se), god: stat(x.god, se) })),
      ageCurve: { "25-27": x.age[0], "34+": x.age[1] },
      ageCurveSe: { "25-27": se, "34+": se },
    },
  };
}
// The 200-replicate NET 4.3.0 vs 3.2.1 run on the 2025-26 NBA league (the prototype's numbers).
const start = { leagueMeanOvr: 52.15, count75: 1, count80: 0 };
const net430 = side({ ovr10: 49.87, c75: 9.17, c80: 2.46, god: 4.62, per: 0.354, sd: 1.775, age: [0.318, -3.79] });
const net321 = side({ ovr10: 50.75, c75: 14.07, c80: 1.49, god: 0.685, per: 1.234, sd: 1.123, age: [-0.346, -3.637] });
const input = (script: SideInput, baseline: SideInput | null, seasons = 10): CheckInput => ({ start, seasons, script, baseline, noScript: null });

describe("balance checks", () => {
  it("grade NET 4.3.0 against 3.2.1 as the prototype does", () => {
    const c = gradeChecks(input(net430, net321));
    expect(c.verdict).toBe("worse");
    expect(c.script).toEqual({ passed: 2, applicable: 7 });
    expect(c.baseline).toEqual({ passed: 6, applicable: 7 });
    const by = Object.fromEntries(c.items.map((i) => [i.id, i]));
    expect(Object.fromEntries(c.items.map((i) => [i.id, i.change?.direction]))).toEqual({
      "league-ovr": "worse",
      "star-count": "better",
      superstars: "same",
      "god-progs": "worse",
      production: "worse",
      predictable: "worse",
      aging: "same",
    });
    expect(by["league-ovr"]!.script).toMatchObject({ display: "−2.3", pass: false });
    expect(by["league-ovr"]!.script!.pctFromStart).toBeCloseTo((-2.28 / 52.15) * 100, 1);
    expect(by["star-count"]!.script!.display).toBe("1 → 9.2");
    expect(by["star-count"]!.change!.note).toBe("fewer 75+ players, still fails");
    expect(by["god-progs"]!.change!.note).toBe("6.7 times as many");
    expect(by["production"]!.change!.pct).toBeCloseTo(-71.3, 0);
    expect(by["aging"]!.script!.display).toBe("+0.32 / −3.79");
    expect(verdictText(c, "net@4.3.0", "net@3.2.1")).toEqual({ title: "Worse than net@3.2.1", text: "Passes fewer checks and breaks 4 that net@3.2.1 passes." });
  });

  it("counts a difference under two standard errors as a tie, not a break", () => {
    // Production sits just under the rule for the script and just over it for the baseline, within noise.
    const a = side({ ovr10: 51, c75: 2, c80: 1, god: 0.5, per: 0.49, sd: 1.1, age: [0, -3], se: 0.05 });
    const b = side({ ovr10: 51, c75: 2, c80: 1, god: 0.5, per: 0.52, sd: 1.1, age: [0, -3], se: 0.05 });
    const c = gradeChecks(input(a, b));
    const production = c.items.find((i) => i.id === "production")!;
    expect([production.script!.pass, production.baseline!.pass]).toEqual([false, true]);
    expect(production.change!.direction).toBe("same");
    expect(c.verdict).toBe("better");
    // With tight standard errors the same gap is a real break.
    const tight = gradeChecks(input(side({ ...shape(a), per: 0.49, se: 0.001 }), side({ ...shape(b), per: 0.52, se: 0.001 })));
    expect(tight.verdict).toBe("worse");
  });

  it("calls a trade of one fixed check for one broken check mixed", () => {
    const base = { ovr10: 51, c75: 2, c80: 1, god: 0.5, per: 1, sd: 1.1, age: [0, -3] as [number, number] };
    const c = gradeChecks(input(side({ ...base, god: 3 }), side({ ...base, sd: 2 })));
    expect(c.verdict).toBe("mixed");
    expect(verdictText(c, "a", "b").text).toBe("Passes as many checks, breaks 1 that b passes and fixes 1 that b fails.");
  });

  it("leaves the league-level checks out of runs shorter than 10 seasons, and the verdict out without a baseline", () => {
    const c = gradeChecks(input(net430, null, 1));
    expect(c.items.filter((i) => !i.applicable).map((i) => i.id)).toEqual(["league-ovr", "star-count", "superstars"]);
    expect(c.items.find((i) => i.id === "league-ovr")!.script).toBeNull();
    expect(c.script).toEqual({ passed: 1, applicable: 4 });
    expect(c.verdict).toBeNull();
    expect(c.baseline).toBeNull();
  });

  it("fills the No script column from the reference run", () => {
    const noScript: SideInput = { quick: null, deep: { ...net321.deep!, seasons: net321.deep!.seasons.map((s, i) => (i === 9 ? { ...s, leagueMeanOvr: stat(47.21), count75: stat(2.58), god: stat(0) } : { ...s, god: stat(0) })) } };
    const c = gradeChecks({ ...input(net430, net321), noScript });
    const by = Object.fromEntries(c.items.map((i) => [i.id, i.noScript?.display ?? null]));
    expect(by).toMatchObject({ "league-ovr": "−4.9", "star-count": "1 → 2.6", "god-progs": "0.0", production: null, aging: null });
  });

  it("pins the rules: editing a threshold needs a new checks version and a CHANGELOG line", () => {
    // If this fails you changed RULES. Bump CHECKS_VERSION, add a lab/CHANGELOG.md entry, then update both values here.
    expect(CHECKS_VERSION).toBe(1);
    expect(rulesSha256()).toBe("47844f2a32585667d4041683dd85ab3d635e21417aaddc549acb9c6b2415add9");
    expect(RULES.tieSe).toBe(2);
  });
});

function shape(s: SideInput): Shape {
  const last = s.deep!.seasons.at(-1)!;
  return { ovr10: last.leagueMeanOvr.mean, c75: last.count75.mean, c80: last.count80.mean, god: s.quick!.godProgsPerRun, per: s.quick!.perEffect!, sd: s.quick!.medianPlayerSd, age: [s.deep!.ageCurve["25-27"]!, s.deep!.ageCurve["34+"]!] };
}

describe("run details", () => {
  const entry = (id: string) => ({ id, sha256: `${id}-sha` }) as Entry;
  const common = { league: { id: "nba-2025-26", name: "NBA" }, preset: { runs: 1000, replicates: 200 }, seed: 69, scripts: [entry("net@4.3.0")], pre: entry("hook@1.0.0") };
  const preseason = { statsSeason: 2025, enteringSeason: 2026, baseDevelop: "export" };
  it("say when NET runs and which stats it reads, per mode", () => {
    expect(seasonLabel(2026)).toBe("2025-26");
    expect(seasonLabel(2000)).toBe("1999-00");
    expect(runDetailsFor({ ...common, mode: "deep", seasons: 10, boundary: preseason })).toMatchObject({ netRuns: "Every offseason, 10 seasons", statsRead: "2024-25 real, then 9 simulated seasons", gamesSimulated: true, runs: 200, seasons: 10 });
    expect(runDetailsFor({ ...common, mode: "season", seasons: 1, boundary: preseason })).toMatchObject({ netRuns: "Once, after the 2025-26 season", statsRead: "2025-26 simulated", runs: 200, seasons: 1 });
    expect(runDetailsFor({ ...common, mode: "quick", seasons: 0, boundary: preseason })).toMatchObject({ netRuns: "Once, right now", statsRead: "2024-25 real", gamesSimulated: false, runs: 1000, seasons: null });
    // A mid-season file plays out its own season.
    expect(runDetailsFor({ ...common, mode: "season", seasons: 1, boundary: { statsSeason: 2017, enteringSeason: 2018, baseDevelop: "copy-last-row" } }).netRuns).toBe("Once, after the 2016-17 season");
  });
});

describe("line diff", () => {
  const apply = (rows: ReturnType<typeof diffLines>) => ({
    a: rows.filter((r) => r.op !== "add").map((r) => r.text),
    b: rows.filter((r) => r.op !== "del").map((r) => r.text),
  });
  const lcs = (a: string[], b: string[]) => {
    const t = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
    for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) t[i]![j] = a[i] === b[j] ? t[i + 1]![j + 1]! + 1 : Math.max(t[i + 1]![j]!, t[i]![j + 1]!);
    return t[0]![0]!;
  };

  it("shows a bumped header as one changed line with numbers on both sides", () => {
    const rows = diffLines("/** NET | v4.3.0 */\nlet x = 2;\nrun();\n", "/** NET | v4.3.1 */\nlet x = 2;\nrun();\n");
    expect(rows).toEqual([
      { op: "del", a: 1, b: null, text: "/** NET | v4.3.0 */" },
      { op: "add", a: null, b: 1, text: "/** NET | v4.3.1 */" },
      { op: "ctx", a: 2, b: 2, text: "let x = 2;" },
      { op: "ctx", a: 3, b: 3, text: "run();" },
    ]);
  });

  it("rebuilds both texts and keeps every common line (a minimal diff)", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let n = 0; n < 200; n++) {
      const a = Array.from({ length: Math.floor(rnd() * 12) }, () => "abcd"[Math.floor(rnd() * 4)]!);
      const b = Array.from({ length: Math.floor(rnd() * 12) }, () => "abcd"[Math.floor(rnd() * 4)]!);
      const rows = diffLines(a.join("\n"), b.join("\n"));
      expect(apply(rows)).toEqual({ a, b });
      expect(rows.filter((r) => r.op === "ctx").length).toBe(lcs(a, b));
      expect(rows.filter((r) => r.a !== null).map((r) => r.a)).toEqual(a.map((_, i) => i + 1));
      expect(rows.filter((r) => r.b !== null).map((r) => r.b)).toEqual(b.map((_, i) => i + 1));
    }
  });
});
