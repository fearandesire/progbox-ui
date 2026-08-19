import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import type { ParsedScorecard } from "../../lib/analysisTypes";
import ScorecardTable from "./ScorecardTable.vue";

const scorecard: ParsedScorecard = {
  scripts: ["v4.1 script", "v4.3 script"],
  colors: ["#2563eb", "#dc2626"],
  metrics: [
    { name: "Players", values: [359, 1234] },
    { name: "Runs", values: [500, 500] },
    { name: "PeakAge", values: [null, 29.194130743] },
    { name: "Drift", values: [-1.8873816, 0.07049] },
    { name: "PrimeSep", values: [1.367061, 0.489224] },
    { name: "%>cap", values: [0, 0.0571] },
    { name: "ICC(Ovr)", values: [0.984074, 0.939839] },
  ],
};

describe("AnalysisSection scorecard handling", () => {
  it("shows a notice instead of the unrenderable table figure when data is missing", async () => {
    const AnalysisSection = (await import("./AnalysisSection.vue")).default;
    const wrapper = mount(AnalysisSection, {
      props: {
        section: {
          id: "scorecard",
          title: "§1 · Scorecard",
          intro: "KPIs.",
          // Upstream emits a go.Table figure here; the cartesian bundle
          // cannot draw it, so it must never be handed to PlotlyChart.
          charts: [{ kind: "figure" as const, payloadId: "payload-1", minHeight: 480 }],
        },
        figures: { "payload-1": { data: [{ type: "table" }], layout: {} } },
        scorecard: null,
      },
      global: { stubs: { PlotlyChart: true } },
    });

    expect(wrapper.text()).toContain("Scorecard data unavailable");
    expect(wrapper.findComponent({ name: "PlotlyChart" }).exists()).toBe(false);
  });
});

describe("ScorecardTable", () => {
  it("renders one column per script with color chips", () => {
    const wrapper = mount(ScorecardTable, { props: { scorecard } });
    const headers = wrapper.findAll("th");
    expect(headers).toHaveLength(3);
    expect(headers[1].text()).toContain("v4.1 script");
    const chips = wrapper.findAll(".scorecard__chip");
    expect(chips[0].attributes("style")).toContain("rgb(37, 99, 235)");
  });

  it("applies the generated dashboard's formatting rules", () => {
    const wrapper = mount(ScorecardTable, { props: { scorecard } });
    const rows = wrapper.findAll("tbody tr");
    const cells = (i: number) => rows[i].findAll("td").map((c) => c.text());

    expect(cells(0)).toEqual(["Players", "359", "1,234"]);
    expect(cells(2)).toEqual(["PeakAge", "-", "29.19"]);
    expect(cells(3)).toEqual(["Drift", "-1.887", "+0.070"]);
    expect(cells(4)).toEqual(["PrimeSep", "+1.367", "+0.489"]);
    expect(cells(5)).toEqual(["%>cap", "0.00%", "5.71%"]);
    expect(cells(6)).toEqual(["ICC(Ovr)", "0.98", "0.94"]);
  });
});
