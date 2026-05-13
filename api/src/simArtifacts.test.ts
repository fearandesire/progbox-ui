import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadOutputsDf,
  playerSummaries,
  playerAllRuns,
  godprogsRecords,
  listChartFilenames,
  chartPath,
  InvalidChartNameError,
} from "./services/simArtifacts.js";
import { useIsolatedOutputs, makeRunDir } from "./testUtils.js";

useIsolatedOutputs();

function rowsFixture(): Record<string, unknown>[] {
  return [
    {
      PlayerID: 0,
      Name: "Alpha One",
      Team: "BOS",
      Age: 29,
      Baseline: 55,
      Ovr: 56,
      Delta: 1.0,
      PER: 18.5,
      DWS: 2.4,
      EWA: 1.2,
    },
    {
      PlayerID: 0,
      Name: "Alpha One",
      Team: "BOS",
      Age: 29,
      Baseline: 55,
      Ovr: 57,
      Delta: 2.0,
      PER: 18.5,
      DWS: 2.4,
      EWA: 1.2,
    },
    {
      PlayerID: 1,
      Name: "Beta Two",
      Team: "NYK",
      Age: 31,
      Baseline: 53,
      Ovr: 52,
      Delta: -1.0,
      PER: 20.1,
      DWS: 1.9,
      EWA: 1.5,
    },
    {
      PlayerID: 1,
      Name: "Beta Two",
      Team: "NYK",
      Age: 31,
      Baseline: 53,
      Ovr: 54,
      Delta: 1.0,
      PER: 20.1,
      DWS: 1.9,
      EWA: 1.5,
    },
  ];
}

describe("simArtifacts", () => {
  it("loadOutputsDf drops Unnamed: 0", () => {
    makeRunDir("20260101120000", { rawRows: rowsFixture() });
    const df = loadOutputsDf("20260101120000");
    expect(Object.keys(df[0]!).includes("Unnamed: 0")).toBe(false);
    expect(df.length).toBe(4);
  });

  it("loadOutputsDf reads C++ style CSV", () => {
    const cppCsv =
      "Run,RunSeed,Name,Team,Age,PlayerID,Baseline,Ovr,Delta,PctChange," +
      "AboveBaseline,PER,DWS,EWA,dIQ,Dnk,Drb,End,2Pt,FT,Ins,Jmp," +
      "oIQ,Pss,Reb,Spd,Str,3Pt,Hgt\n" +
      "0,12345,Alpha One,BOS,29,0,55.0,56.0,1.0,0.018182,True," +
      "18.5,2.4,1.2,54,50,51,52,53,54,55,56,57,58,59,60,61,62,63\n" +
      "0,12345,Beta Two,NYK,31,1,53.0,52.0,-1.0,-0.018868,False," +
      "20.1,1.9,1.5,54,50,51,52,53,54,55,56,57,58,59,60,61,62,63\n";
    makeRunDir("20260201120000", {
      metadata: { build: "20260201120000", status: "complete" },
      extraFiles: { "raw/outputs.csv": cppCsv },
    });
    const df = loadOutputsDf("20260201120000");
    expect(Object.keys(df[0]!).includes("Unnamed: 0")).toBe(false);
    expect(Object.keys(df[0]!)[0]).toBe("Run");
    expect(df.length).toBe(2);
  });

  it("listChartFilenames sorted png only", () => {
    makeRunDir("20260101120000", { charts: ["02_beta.png", "01_alpha.png", "notes.txt"] });
    expect(listChartFilenames("20260101120000")).toEqual(["01_alpha.png", "02_beta.png"]);
  });

  it("chartPath rejects traversal", () => {
    makeRunDir("20260101120000", { charts: ["01_alpha.png"] });
    expect(() => chartPath("20260101120000", "../secrets.png")).toThrow(InvalidChartNameError);
    expect(() => chartPath("20260101120000", "subdir/chart.png")).toThrow(InvalidChartNameError);
  });

  it("player summaries and detail", () => {
    makeRunDir("20260101120000", { rawRows: rowsFixture() });
    const summary = playerSummaries("20260101120000");
    expect(summary.map((r) => r.PlayerID)).toEqual([0, 1]);
    expect(summary[0]!.Name).toBe("Alpha One");
    expect(summary[0]!.MeanDelta).toBeCloseTo(1.5, 5);
    expect(summary[0]!.StdDelta).toBeCloseTo(0.7071, 3);
    const detail = playerAllRuns("20260101120000", "0");
    expect(detail.length).toBe(2);
    expect(detail.map((r) => r.Delta)).toEqual([1, 2]);
    expect(playerAllRuns("20260101120000", "999")).toEqual([]);
  });

  it("godprogsRecords", () => {
    makeRunDir("20260101120000", {
      rawRows: rowsFixture(),
      godprogs: [{ name: "Alpha One", run_seed: 1 }],
    });
    expect(godprogsRecords("20260101120000")).toEqual([{ name: "Alpha One", run_seed: 1 }]);
    makeRunDir("20260201120000");
    expect(godprogsRecords("20260201120000")).toEqual([]);
    const bad = makeRunDir("20260301120000");
    fs.mkdirSync(path.join(bad, "raw"), { recursive: true });
    fs.writeFileSync(path.join(bad, "raw", "godprogs.json"), "{}", "utf8");
    expect(godprogsRecords("20260301120000")).toEqual([]);
  });
});
