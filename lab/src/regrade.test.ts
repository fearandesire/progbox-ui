import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

const dataDir = vi.hoisted(() => {
  const dir = require("node:fs").mkdtempSync(require("node:path").join(require("node:os").tmpdir(), "lab-regrade-"));
  process.env.LAB_DATA_DIR = dir;
  return dir as string;
});

const { listRuns, regrade } = await import("./lab.ts");

afterAll(() => fs.rmSync(dataDir, { recursive: true, force: true }));

const stat = (mean: number, se = 0.02) => ({ mean, se });
const season = (ovr: number, c75: number, c80: number, god: number) => ({ leagueMeanOvr: stat(ovr), count75: stat(c75), count80: stat(c80), god: stat(god) });
const kpis = (god: number, per: number, sd: number) => ({ runs: 1000, godProgsPerRun: god, medianPlayerSd: sd, perEffect: per, deltaByAge: {} });

/** A run folder as NET Lab 0.2.0 wrote it: no checks, no start values, no Monte Carlo SEs. */
function oldRun(runId: string) {
  const dir = path.join(dataDir, "runs", runId);
  fs.mkdirSync(dir, { recursive: true });
  const seasons = (last: ReturnType<typeof season>) => [season(51.8, 2, 0, 1), ...Array.from({ length: 8 }, () => season(51, 4, 1, 1)), last];
  const report = {
    verdict: "Review flags",
    flags: [],
    mode: "deep",
    league: { id: "gone-league" },
    script: { id: "net@4.3.0", kpis: kpis(4.6, 0.35, 1.77) },
    baseline: { id: "net@3.2.1", kpis: kpis(0.69, 1.23, 1.12) },
    deep: {
      script: { seasons: seasons(season(49.9, 9.2, 2.5, 3)), ageCurve: { "25-27": 0.32, "34+": -3.79 }, failed: 0 },
      baseline: { seasons: seasons(season(50.7, 14.1, 1.5, 0.4)), ageCurve: { "25-27": -0.35, "34+": -3.64 }, failed: 0 },
    },
  };
  fs.writeFileSync(path.join(dir, "report.json"), JSON.stringify(report));
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ lab_version: "0.2.0", league: { id: "gone-league", sha256: "x" } }));
  fs.writeFileSync(path.join(dir, "status.json"), JSON.stringify({ runId, state: "done", script: "net@4.3.0" }));
  // 25 players so the PER effect's standard error can be rebuilt from the CSV.
  const rows = Array.from({ length: 25 }, (_, i) => `${i},"P, ${i}",${i % 5},${24 + (i % 12)},${8 + i},,${45 + (i % 9)},1000,0,${(i % 7) * 0.3 - 1},1.5`);
  fs.writeFileSync(path.join(dir, "players.csv"), ["pid,name,tid,age,per,bpm,baseOvr,runs,meanOvr,meanDelta,sdDelta", ...rows].join("\n"));
  return dir;
}

describe("regrade", () => {
  it("grades an old run with today's rules from its saved files, without re-simulating", () => {
    const dir = oldRun("20261007000001");
    const r = regrade("20261007000001");
    expect(r.before).toMatchObject({ verdict: null, flagsVerdict: "Review flags", checksVersion: null, labVersion: "0.2.0", checks: null });
    // The league file is gone, so the start comes from the run's first season.
    expect(r.start).toEqual({ source: "first-season", value: { leagueMeanOvr: 51.8, count75: 2, count80: 0 } });
    expect(r.after.verdict).toBe("worse");
    expect(r.after.script).toEqual({ passed: 2, applicable: 7 });
    expect(r.after.baseline).toEqual({ passed: 6, applicable: 7 });
    expect(r.changed).toHaveLength(7);
    const saved = JSON.parse(fs.readFileSync(path.join(dir, "regrade.json"), "utf8"));
    expect(saved.after.version).toBe(r.after.version);
    expect(saved.lab.version).toBe("0.3.0");
    // report.json is left alone.
    expect(JSON.parse(fs.readFileSync(path.join(dir, "report.json"), "utf8")).checks).toBeUndefined();
  });

  it("fills an old run's Lab version from its manifest in the run list", () => {
    expect(listRuns().find((r) => r.runId === "20261007000001")?.lab).toEqual({ version: "0.2.0", checksVersion: null });
  });

  it("refuses run ids that are paths", () => {
    expect(() => regrade("../x")).toThrow(/Invalid run id/);
    expect(() => regrade("20990101000000")).toThrow(/no report.json/);
  });
});

