import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { makeRunDir, useIsolatedOutputs } from "../testUtils.js";
import {
  MarkersNotFoundError,
  SCRIPT_PALETTE,
  analysisPayloadsPath,
  extractDashboard,
  getAnalysisData,
  parseScorecardCsv,
} from "./analysisExtract.js";
import type { PlotlyFigureJson } from "./analysisExtract.js";

const fixturesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "__fixtures__",
);

const singleRunHtml = fs.readFileSync(
  path.join(fixturesDir, "analysis_dashboard.sample.html"),
  "utf8",
);
const comparisonHtml = fs.readFileSync(
  path.join(fixturesDir, "comparison_dashboard.sample.html"),
  "utf8",
);
const scorecardCsv = fs.readFileSync(
  path.join(fixturesDir, "comparison_scorecard.sample.csv"),
  "utf8",
);

describe("extractDashboard", () => {
  it("extracts hero, subtitle, stat cards, sections and figures", () => {
    const d = extractDashboard(singleRunHtml);

    expect(d.schemaVersion).toBe(1);
    expect(d.hero.title).toBe("Monte Carlo Tuning Dashboard");
    expect(d.hero.subtitle).toBe("script: NET v4.3");

    expect(d.statCards).toHaveLength(5);
    expect(d.statCards[0]).toEqual({ label: "Players", value: "359", color: null });
    expect(d.statCards[3]).toEqual({
      label: "Convergence",
      value: "98%",
      color: "#16a34a",
    });

    expect(d.sections.map((s) => s.id)).toEqual(["league-health", "player-explorer"]);
    expect(d.sections[0].title).toBe("§1 · League Health");
    expect(d.sections[0].intro).toContain("Macro view");
  });

  it("maps figures to sections via data-src with min-heights", () => {
    const d = extractDashboard(singleRunHtml);
    expect(d.sections[0].charts).toEqual([
      { kind: "figure", payloadId: "payload-1", minHeight: 450 },
      { kind: "figure", payloadId: "payload-2", minHeight: 520 },
    ]);
    expect(Object.keys(d.figures).sort()).toEqual(["payload-1", "payload-2"]);
  });

  it("parses figure JSON containing the <\\/ escape and subplot axes", () => {
    const d = extractDashboard(singleRunHtml);
    const fig1 = d.figures["payload-1"] as PlotlyFigureJson & {
      data: { hovertext?: string }[];
    };
    expect(fig1.data[0].hovertext).toBe("see docs at </b> here");
    const fig2 = d.figures["payload-2"];
    expect(fig2.layout).toHaveProperty("xaxis2");
    expect(fig2.layout).toHaveProperty("yaxis2");
  });

  it("extracts the player-explorer payload and marks its section", () => {
    const d = extractDashboard(singleRunHtml);
    const explorerSection = d.sections.find((s) => s.id === "player-explorer");
    expect(explorerSection?.charts).toEqual([{ kind: "player-explorer" }]);
    const explorer = d.playerExplorer as {
      leagueMean: number;
      players: { label: string; mode: string }[];
    };
    expect(explorer.leagueMean).toBe(1.25);
    expect(explorer.players).toHaveLength(2);
    expect(explorer.players[0].label).toBe("Alpha Man (SEA, 24)");
    expect(explorer.players[1].mode).toBe("hist");
  });

  it("extracts comparison dashboards (no explorer)", () => {
    const d = extractDashboard(comparisonHtml);
    expect(d.hero.title).toBe("Progression Script Comparison");
    expect(d.hero.subtitle).toBe("2 scripts: v4.1, v4.3");
    expect(d.statCards.map((c) => c.label)).toEqual([
      "Scripts",
      "Peak-age span",
      "Players",
      "Runs each",
    ]);
    expect(d.sections.map((s) => s.id)).toEqual(["scorecard", "age-curve"]);
    expect(d.playerExplorer).toBeNull();
  });

  it("throws MarkersNotFoundError on fallback-style HTML without payloads", () => {
    const fallbackHtml =
      "<html><body><h1>Analysis</h1><table><tr><td>1</td></tr></table></body></html>";
    expect(() => extractDashboard(fallbackHtml)).toThrow(MarkersNotFoundError);
  });
});

describe("getAnalysisData cache", () => {
  useIsolatedOutputs();

  it("extracts, writes the cache file, and reuses it", () => {
    const build = "20260101120000";
    makeRunDir(build, {
      extraFiles: { "analysis_dashboard.html": singleRunHtml },
    });

    const first = getAnalysisData(build);
    expect(first.sections).toHaveLength(2);
    const cachePath = analysisPayloadsPath(build);
    expect(fs.existsSync(cachePath)).toBe(true);

    // Tamper with the cache; while it is newer than the HTML it wins.
    const tampered = { ...first, hero: { title: "FROM CACHE", subtitle: "" } };
    fs.writeFileSync(cachePath, JSON.stringify(tampered), "utf8");
    expect(getAnalysisData(build).hero.title).toBe("FROM CACHE");
  });

  it("re-extracts when the dashboard HTML is newer than the cache", () => {
    const build = "20260101120001";
    const runDir = makeRunDir(build, {
      extraFiles: { "analysis_dashboard.html": singleRunHtml },
    });
    const htmlPath = path.join(runDir, "analysis_dashboard.html");
    const cachePath = analysisPayloadsPath(build);

    const stale = { ...getAnalysisData(build), hero: { title: "STALE", subtitle: "" } };
    fs.writeFileSync(cachePath, JSON.stringify(stale), "utf8");
    // Make the HTML strictly newer than the cache we just wrote.
    const future = Date.now() + 60_000;
    fs.utimesSync(htmlPath, new Date(future), new Date(future));

    expect(getAnalysisData(build).hero.title).toBe("Monte Carlo Tuning Dashboard");
  });

  it("re-extracts when the cached file is corrupt", () => {
    const build = "20260101120002";
    makeRunDir(build, {
      extraFiles: { "analysis_dashboard.html": singleRunHtml },
    });
    getAnalysisData(build);
    fs.writeFileSync(analysisPayloadsPath(build), "not json {", "utf8");
    expect(getAnalysisData(build).hero.title).toBe("Monte Carlo Tuning Dashboard");
  });
});

describe("parseScorecardCsv", () => {
  it("parses scripts, palette colors and metric rows", () => {
    const sc = parseScorecardCsv(scorecardCsv);
    expect(sc.scripts).toEqual([
      "v4.1, new progression script with EWA and DWS on top of PER",
      "v4.3, new and improved progression script",
    ]);
    expect(sc.colors).toEqual([SCRIPT_PALETTE[0], SCRIPT_PALETTE[1]]);
    expect(sc.metrics.map((m) => m.name)).toEqual([
      "Players",
      "Runs",
      "PeakAge",
      "PrimeSep",
      "PrimeSep(OVRadj)",
      "DeclineSlope",
      "Drift",
      "MedianσΔ",
      "ICC(Ovr)",
      "KendallW",
      "P99 Ovr",
      "%>cap",
      "GodProg/run",
    ]);

    const peakAge = sc.metrics.find((m) => m.name === "PeakAge");
    // v4.1 has an empty PeakAge cell -> null; v4.3 has a value.
    expect(peakAge?.values[0]).toBeNull();
    expect(peakAge?.values[1]).toBeCloseTo(29.1941, 3);

    const players = sc.metrics.find((m) => m.name === "Players");
    expect(players?.values).toEqual([359, 359]);
  });
});
