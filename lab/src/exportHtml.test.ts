import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildChartData, exportRunHtml, renderRunHtml, type ExportableReport } from "./exportHtml.ts";

const stat = (mean: number) => ({ mean, se: 0.01 });
const season = (season: number, ovr: number) => ({
  season,
  progressed: stat(300),
  meanDelta: stat(-1),
  god: stat(4),
  leagueMeanOvr: stat(ovr),
  count75: stat(3),
  count80: stat(1),
  maxOvr: stat(80),
  retired: stat(0),
  drafted: stat(0),
});
const kpis = (meanDelta: number) => ({
  runs: 1000,
  progressedPerRun: 328,
  meanDelta,
  perEffect: 0.35,
  deltaByAge: { "25-27": { n: 10, meanDelta: 0.5, se: 0.01 }, "34+": { n: 10, meanDelta: -4, se: 0.01 } },
});

const report: ExportableReport = {
  mode: "deep",
  lab: { version: "0.3.1", commit: "57823ba", checks: { version: 2, rulesSha256: "cfbec5b9e08f" }, statgen: "statgen-2026-10-08" },
  runDetails: { netRuns: "Every offseason, 10 seasons", runs: 200, seed: 69, scripts: [{ id: "net@4.3.0", sha256: "c5959e65aa" }] },
  league: { id: "nba", name: "Real NBA <2025-26>" },
  script: { id: "net@4.3.0", kpis: kpis(-0.91) },
  baseline: { id: "net@3.2.1", kpis: kpis(-0.89) },
  checks: {
    items: [
      {
        name: "League average OVR holds",
        unit: "OVR change",
        rule: "within 1.5 OVR",
        basis: "multi-season",
        script: { display: "−2.3", pass: false },
        baseline: { display: "−1.4", pass: true },
        noScript: { display: "−4.9" },
      },
    ],
  },
  deep: {
    start: { leagueMeanOvr: 52.1, count75: 1, count80: 0 },
    script: { seasons: [season(2026, 51.8), season(2027, 51.5)], ageCurve: { "25-27": 0.3, "34+": -3.8 }, ageCurveSe: { "25-27": 0.01, "34+": 0.02 } },
    baseline: { seasons: [season(2026, 51.9), season(2027, 51.7)], ageCurve: { "25-27": -0.3, "34+": -3.6 } },
    noScript: { seasons: [season(2026, 52.1), season(2027, 51.3)] },
  },
};

describe("export-html", () => {
  it("builds season charts with a start point and every side", () => {
    const d = buildChartData(report);
    const ovr = d.seasonCharts[0];
    expect(ovr.x).toEqual(["Start", "2026", "2027"]);
    expect(ovr.series.script?.map((p) => p?.mean)).toEqual([52.1, 51.8, 51.5]);
    expect(ovr.series.noScript).not.toBeNull();
    expect(d.seasonCharts.find((c) => c.title.startsWith("God progs"))?.series.noScript).toBeNull();
    expect(d.ageCharts.map((c) => c.x)).toEqual([["25-27", "34+"], ["25-27", "34+"]]);
  });

  it("renders data only, escaped, with axis titles", () => {
    const html = renderRunHtml(report, "20261017004308");
    expect(html).toContain("Real NBA &lt;2025-26&gt;");
    expect(html).not.toContain("Real NBA <2025-26>");
    expect(html).toContain("ΔOVR per player per offseason");
    expect(html).toContain("✗ −2.3");
    expect(html).not.toMatch(/Worse than|Better than|Mixed/);
  });

  it("works for a run without deep seasons or a baseline", () => {
    const quick = { ...report, mode: "quick", deep: null, baseline: null, checks: null };
    const d = buildChartData(quick);
    expect(d.seasonCharts).toHaveLength(0);
    expect(d.ageCharts).toHaveLength(1);
    expect(renderRunHtml(quick, "q")).not.toContain("players.baseline.csv");
  });

  it("labels the first-offseason data as simulated in season mode", () => {
    const afterSeason = { ...report, mode: "season" };
    const note = buildChartData(afterSeason).ageCharts.at(-1)?.note;
    expect(note).toContain("the simulated season's stats");
    const html = renderRunHtml(afterSeason, "s");
    expect(html).toContain("the simulated season's stats");
    expect(html).not.toContain("the file's own stats");
  });

  it("writes the page next to copies of the run's data", () => {
    const run = fs.mkdtempSync(path.join(os.tmpdir(), "lab-run-"));
    fs.writeFileSync(path.join(run, "report.json"), JSON.stringify(report));
    fs.writeFileSync(path.join(run, "players.csv"), "pid\n1\n");
    const out = path.join(run, "site");
    const page = exportRunHtml(run, out);
    expect(fs.readFileSync(page, "utf8")).toContain("<svg data-chart=\"seasonCharts:0\"");
    expect(fs.existsSync(path.join(out, "report.json"))).toBe(true);
    expect(fs.existsSync(path.join(out, "players.csv"))).toBe(true);
  });

  it("exports a legacy report using only recorded metadata", () => {
    const old: ExportableReport = {
      mode: "deep",
      league: { id: "legacy" },
      script: { id: "net@4.3.0", kpis: kpis(-1) },
      deep: { script: { seasons: [{ leagueMeanOvr: stat(50), count75: stat(2), count80: stat(1), god: stat(3) }] } },
    };
    expect(renderRunHtml(old, "legacy")).not.toContain("<th>NET Lab</th>");
    const run = fs.mkdtempSync(path.join(os.tmpdir(), "lab-legacy-"));
    try {
      fs.writeFileSync(path.join(run, "report.json"), JSON.stringify(old));
      fs.writeFileSync(path.join(run, "manifest.json"), JSON.stringify({ lab_version: "0.2.0", league: { id: "legacy", name: "Legacy league" }, spec: { seed: 123 }, presets: { replicates: 40 } }));
      const page = exportRunHtml(run, path.join(run, "site"));
      const html = fs.readFileSync(page, "utf8");
      expect(html).toContain("Legacy league");
      expect(html).toContain("0.2.0");
      expect(html).toContain("<th>Seed</th><td>123</td>");
      expect(html).toContain("Mean of 40 runs");
      expect(html).not.toContain("<th>Checks</th>");
      expect(buildChartData(old).seasonCharts[0]?.x).toEqual(["1"]);
      expect(buildChartData(old).seasonCharts[0]?.xTitle).toBe("Offseason");
    } finally {
      fs.rmSync(run, { recursive: true, force: true });
    }
  });

  it("omits empty charts when every replicate failed", () => {
    const failed: ExportableReport = {
      ...report,
      script: { ...report.script, kpis: { runs: 200, deltaByAge: {} } },
      baseline: null,
      deep: { script: { seasons: [], ageCurve: {} } },
    };
    expect(buildChartData(failed).seasonCharts).toHaveLength(0);
    expect(buildChartData(failed).ageCharts).toHaveLength(0);
    expect(renderRunHtml(failed, "failed")).not.toContain("<svg");
  });

  it("keeps comparison seasons aligned when only the script failed", () => {
    const partial: ExportableReport = { ...report, deep: { ...report.deep!, script: { seasons: [] } } };
    const chart = buildChartData(partial).seasonCharts[0];
    expect(chart.x).toEqual(["Start", "2026", "2027"]);
    expect(chart.series.script).toBeNull();
    expect(chart.series.baseline).toHaveLength(3);
  });
});
