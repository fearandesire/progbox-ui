import { describe, expect, it } from "vitest";
import {
  changeText,
  filterCounts,
  fmtPct,
  labVersionText,
  moveGroups,
  runDetailRows,
  shortId,
  showCheck,
  verdictText,
} from "./labChecks";
import type { LabCheckItem, LabChecks } from "./labTypes";

function item(id: string, script: boolean | null, baseline: boolean | null, direction: "better" | "worse" | "same" | null, pct: number | null = null): LabCheckItem {
  return {
    id,
    name: id,
    unit: "OVR",
    rule: "rule",
    applicable: script !== null,
    script: { value: 1, display: "1", pass: script, pctFromStart: null },
    baseline: { value: 1, display: "1", pass: baseline, pctFromStart: null },
    noScript: null,
    change: direction ? { pct, direction, note: "" } : null,
  };
}

const WORSE: LabChecks = {
  version: 1,
  rulesSha256: "3f2a91c0aa",
  verdict: "worse",
  script: { passed: 2, applicable: 7 },
  baseline: { passed: 6, applicable: 7 },
  items: [
    item("league-ovr", false, true, "worse", 68),
    item("star-count", false, false, "better", -35),
    item("superstars", true, true, "same", 67),
    item("god-progs", false, true, "worse", 570),
    item("production", false, true, "worse", -72),
    item("predictable", false, true, "worse", 58),
    item("aging", true, true, "same", 4),
  ],
};

describe("check formatting", () => {
  it.each([
    [68, "+68%"],
    [-3.66, "−3.7%"],
    [4, "+4%"],
    [4.04, "+4%"],
    [-35, "−35%"],
    [570, "+570%"],
    [0.02, "0%"],
    [null, ""],
    [Number.NaN, ""],
  ] as const)("formats %s as %s", (input, out) => {
    expect(fmtPct(input)).toBe(out);
  });

  it("writes the change column as percent plus direction, or just the direction", () => {
    expect(changeText(item("a", true, true, "worse", 68))).toBe("+68% worse");
    expect(changeText(item("a", true, true, "same", null))).toBe("Same");
    expect(changeText(item("a", true, true, null))).toBe("–");
  });

  it("shortens ids to their version", () => {
    expect(shortId("net@3.2.1")).toBe("3.2.1");
    expect(shortId("plain")).toBe("plain");
  });
});

describe("check filters and groups", () => {
  it("counts all, script fails and checks that differ from the baseline", () => {
    expect(filterCounts(WORSE)).toEqual({ all: 7, fail: 5, diff: 5 });
    expect(showCheck(WORSE.items[2]!, "diff")).toBe(false);
    expect(showCheck(WORSE.items[1]!, "fail")).toBe(true);
  });

  it("orders the verdict rows Worse, Better, Same and drops empty ones", () => {
    const g = moveGroups(WORSE);
    expect(g.map((x) => [x.direction, x.items.length])).toEqual([["worse", 4], ["better", 1], ["same", 2]]);
    expect(moveGroups({ ...WORSE, items: [item("a", true, true, "same")] }).map((x) => x.direction)).toEqual(["same"]);
  });
});

describe("verdictText", () => {
  it("names the baseline and counts the checks it breaks", () => {
    expect(verdictText(WORSE, "net@4.3.0", "net@3.2.1")).toEqual({
      tone: "bad",
      title: "Worse than net@3.2.1",
      line: "Passes fewer checks and breaks 4 that net@3.2.1 passes.",
    });
  });

  it("reads Better and Mixed with both scores", () => {
    const better = verdictText({ ...WORSE, verdict: "better", script: { passed: 6, applicable: 7 }, items: [] }, "a", "b");
    expect(better.tone).toBe("good");
    expect(better.line).toBe("Passes 6 of 7 to 6 of 7 and breaks none that b passes.");
    expect(verdictText({ ...WORSE, verdict: "mixed" }, "a", "b").title).toBe("Mixed against b");
  });

  it("has no verdict without a baseline", () => {
    const v = verdictText({ ...WORSE, verdict: null, baseline: null }, "net@4.4.0-draft.1", null);
    expect(v.title).toBe("net@4.4.0-draft.1 passes 2 of 7 checks");
    expect(v.tone).toBe("neutral");
  });
});

describe("run details", () => {
  it("lists run settings and version stamps with short hashes", () => {
    const rows = runDetailRows(
      {
        mode: "deep",
        netRuns: "Every offseason, 10 seasons",
        gamesSimulated: true,
        statsRead: "2024-25 real, then 9 simulated seasons",
        league: { id: "nba-2025-26", name: "Real NBA 2025-26, Opening Night" },
        runs: 200,
        seasons: 10,
        seed: 20261008,
        scripts: [{ id: "net@4.3.0", sha256: "c5959e65deadbeef" }],
        pre: { id: "hook@1.0.0", sha256: "c0f12d9d" },
      },
      { version: "0.3.0", commit: "54bc484", checks: { version: 1, rulesSha256: "3f2a91c0ffff" }, statgen: null },
    );
    expect(Object.fromEntries(rows)).toMatchObject({
      Games: "Simulated (StatGen, fit to BBGM output)",
      Runs: "200, seed 20261008",
      Scripts: "net@4.3.0 c5959e65…, hook@1.0.0",
      "NET Lab": "0.3.0, commit 54bc484",
      Checks: "checks v1, rules 3f2a91c0…",
      StatGen: "Not used",
    });
    expect(runDetailRows(null, null)).toEqual([]);
  });

  it("reads the History lab column from either list shape", () => {
    expect(labVersionText({ version: "0.3.0", checks: 1 })).toEqual({ text: "0.3.0", title: "NET Lab 0.3.0, checks v1" });
    expect(labVersionText({ version: "0.3.0", checks: { version: 2 } }).title).toBe("NET Lab 0.3.0, checks v2");
    expect(labVersionText({ version: "0.3.0", checksVersion: 1 }).title).toBe("NET Lab 0.3.0, checks v1");
    expect(labVersionText({ version: null, checksVersion: null }).text).toBe("–");
    expect(labVersionText(undefined).text).toBe("–");
  });
});
