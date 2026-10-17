import { mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { describe, expect, it } from "vitest";
import { deepSide, player, report } from "../../test/labFixtures";
import type { LabDeepSide } from "../../lib/labTypes";
import LabReport from "./LabReport.vue";

// Chart.js needs a canvas; render each chart as plain text so the data it receives is visible.
const ChartStub = defineComponent({
  props: {
    kind: { type: String, default: undefined },
    labels: { type: Array, default: undefined },
    series: { type: Array, default: undefined },
    yTitle: { type: String, default: undefined },
    xTitle: { type: String, default: undefined },
    chartLabel: { type: String, default: undefined },
  },
  setup(props, { slots }) {
    return () =>
      h("figure", { "data-test": "chart", "data-kind": props.kind, "data-label": props.chartLabel }, [
        h("pre", { "data-test": "chart-json" }, JSON.stringify({ labels: props.labels, series: props.series })),
        h("div", { "data-test": "chart-note" }, slots.default?.()),
      ]);
  },
});

type Props = InstanceType<typeof LabReport>["$props"];

function build(over: Partial<Props> = {}) {
  const props: Props = {
    report: report(),
    players: { script: [player(1, "Ann", 0.5, 20)], baseline: [player(2, "Bob", -1.5, 10)] },
    deep: null,
    ...over,
  };
  return mount(LabReport, { props, global: { stubs: { LabChart: ChartStub } } });
}

const chartByLabel = (w: ReturnType<typeof build>, label: string) => {
  const el = w.findAll('[data-test="chart"]').find((c) => c.attributes("data-label") === label);
  if (!el) throw new Error(`no chart ${label}`);
  return { note: el.find('[data-test="chart-note"]').text(), ...JSON.parse(el.find('[data-test="chart-json"]').text()) };
};

const deep = { script: deepSide(0.5), baseline: deepSide(0) as LabDeepSide | null };

describe("LabReport", () => {
  describe("offseason tab", () => {
    it("is the default when there is no deep data and labels the seasons tab with N", () => {
      const w = build();
      const tabs = w.findAll('[role="tab"]');
      expect(tabs.map((t) => t.text())).toEqual(["This offseason", "Over N seasons"]);
      expect(tabs[0].attributes("aria-selected")).toBe("true");
      expect(tabs[1].attributes("aria-selected")).toBe("false");
      expect(w.text()).toContain("Distribution of each player's mean ΔOVR");
      expect(w.text()).toContain("Does production matter? PER vs mean ΔOVR");
      expect(w.findAll('[data-test="chart"]')).toHaveLength(2);
    });

    it("bins mean deltas into 1-OVR bins, clamping the end bins", () => {
      const ps = [player(1, "Low", -25), player(2, "Edge", -10), player(3, "Zero", 0), player(4, "Mid", 2.5), player(5, "High", 6), player(6, "Huge", 40)];
      const w = build({ players: { script: ps, baseline: null } });
      const { labels, series } = chartByLabel(w, "Histogram of player mean OVR change");
      expect(labels).toHaveLength(16);
      expect(labels[0]).toBe("-10");
      expect(labels[10]).toBe("0");
      expect(labels[11]).toBe("+1");
      expect(labels[15]).toBe("+5");
      expect(series).toHaveLength(1);
      const data: number[] = series[0].data;
      expect(data[0]).toBe(2); // -25 and -10
      expect(data[10]).toBe(1); // 0
      expect(data[12]).toBe(1); // 2.5
      expect(data[15]).toBe(2); // 6 and 40
      expect(data.reduce((a, b) => a + b, 0)).toBe(6);
    });

    it("draws baseline and script histograms when a baseline exists", () => {
      const { series } = chartByLabel(build(), "Histogram of player mean OVR change");
      expect(series.map((s: { name: string; role: string }) => [s.name, s.role])).toEqual([["net@3.2.1", "baseline"], ["net@4.3.0", "script"]]);
    });

    it("draws only the script when players.baseline is null", () => {
      const w = build({ players: { script: [player(1, "Ann", 1)], baseline: null } });
      expect(chartByLabel(w, "Histogram of player mean OVR change").series).toHaveLength(1);
      expect(chartByLabel(w, "Prior-season PER against mean OVR change per player").series).toHaveLength(1);
    });

    it("draws only the script when the report has no baseline, even if baseline players exist", () => {
      const w = build({ report: report({ baseline: null }) });
      expect(chartByLabel(w, "Histogram of player mean OVR change").series.map((s: { name: string }) => s.name)).toEqual(["net@4.3.0"]);
      expect(chartByLabel(w, "Prior-season PER against mean OVR change per player").series).toHaveLength(1);
    });

    it("scatters PER against mean delta, skipping players without PER", () => {
      const w = build({ players: { script: [player(1, "Ann", 0.5, 20), player(2, "NoPer", 1, null)], baseline: null } });
      const { series } = chartByLabel(w, "Prior-season PER against mean OVR change per player");
      expect(series[0].data).toEqual([{ x: 20, y: 0.5 }]);
      expect(series[0].tips).toEqual(["Ann (27)"]);
    });

    it("handles empty player lists", () => {
      const w = build({ players: { script: [], baseline: [] } });
      const hist = chartByLabel(w, "Histogram of player mean OVR change");
      expect(hist.series.every((s: { data: number[] }) => s.data.every((n) => n === 0))).toBe(true);
      expect(chartByLabel(w, "Prior-season PER against mean OVR change per player").series[1].data).toEqual([]);
    });

    it("explains the PER effect for both scripts, with a dash for a missing effect", () => {
      const note = chartByLabel(build(), "Prior-season PER against mean OVR change per player").note.replace(/\s+/g, " ");
      expect(note).toContain("net@3.2.1 – vs net@4.3.0 0.42 OVR per SD of PER.");
    });

    it("formats the baseline effect when present", () => {
      const r = report();
      r.baseline!.kpis.perEffect = 0.123;
      const note = chartByLabel(build({ report: r }), "Prior-season PER against mean OVR change per player").note.replace(/\s+/g, " ");
      expect(note).toContain("net@3.2.1 0.12 vs net@4.3.0 0.42");
    });

    it("omits the baseline sentence without a baseline, and shows a dash for a null script effect", () => {
      const r = report({ baseline: null });
      r.script.kpis.perEffect = null;
      const note = chartByLabel(build({ report: r }), "Prior-season PER against mean OVR change per player").note.replace(/\s+/g, " ");
      expect(note).toBe("OLS, holding age and base OVR fixed: net@4.3.0 – OVR per SD of PER.");
    });
  });

  describe("seasons tab", () => {
    it("opens on the seasons tab when deep data is present and names the season count", () => {
      const w = build({ deep });
      const tabs = w.findAll('[role="tab"]');
      expect(tabs[1].text()).toBe("Over 2 seasons");
      expect(tabs[1].attributes("aria-selected")).toBe("true");
      expect(tabs[0].attributes("aria-selected")).toBe("false");
      expect(w.text()).toContain("League mean OVR by season");
      expect(w.text()).not.toContain("Distribution of each player's mean ΔOVR");
      expect(w.findAll('[data-test="chart"]')).toHaveLength(5);
    });

    it("shows a quick-run message when there is no deep data", async () => {
      const w = build();
      await w.get('[data-test="seasons-tab"]').trigger("click");
      expect(w.get('[data-test="no-deep"]').text()).toContain("This was a quick run");
      expect(w.findAll('[data-test="chart"]')).toHaveLength(0);
      expect(w.findAll('[role="tab"]')[1].attributes("aria-selected")).toBe("true");
      expect(w.findAll('[role="tab"]')[1].text()).toBe("Over N seasons");
    });

    it("switches between tabs on click", async () => {
      const w = build({ deep });
      await w.findAll('[role="tab"]')[0].trigger("click");
      expect(w.text()).toContain("Distribution of each player's mean ΔOVR");
      expect(w.findAll('[role="tab"]')[0].attributes("aria-selected")).toBe("true");
      await w.get('[data-test="seasons-tab"]').trigger("click");
      expect(w.text()).toContain("God progs per season");
      expect(w.text()).not.toContain("Distribution of each player's mean ΔOVR");
    });

    it("plots per-season means and standard errors for baseline and script", () => {
      const w = build({ deep });
      const mean = chartByLabel(w, "League mean OVR after each offseason");
      expect(mean.labels).toEqual([2026, 2027]);
      expect(mean.series).toEqual([
        { name: "net@3.2.1", role: "baseline", data: [47, 47], se: [0.1, 0.1] },
        { name: "net@4.3.0", role: "script", data: [47.5, 47.5], se: [0.1, 0.1] },
      ]);
      expect(chartByLabel(w, "Count of players at 75 OVR or higher by season").series[1].data).toEqual([20, 20]);
      expect(chartByLabel(w, "God progs per season").series[1].data).toEqual([0.5, 0.5]);
      expect(chartByLabel(w, "Mean OVR change per season").series[1].data).toEqual([0.7, 1.7]);
    });

    it("plots only the script when deep.baseline is null", () => {
      const w = build({ deep: { script: deepSide(0), baseline: null } });
      const s = chartByLabel(w, "League mean OVR after each offseason").series;
      expect(s).toHaveLength(1);
      expect(s[0].role).toBe("script");
      expect(chartByLabel(w, "Mean OVR change by age band over all seasons").series).toHaveLength(1);
    });

    it("plots only the script when the report has no baseline id", () => {
      const w = build({ deep, report: report({ baseline: null }) });
      expect(chartByLabel(w, "God progs per season").series).toHaveLength(1);
      expect(chartByLabel(w, "Mean OVR change by age band over all seasons").series).toHaveLength(1);
    });

    it("builds the age curve from known bands only, with nulls for gaps in the baseline", () => {
      const base = deepSide(0);
      base.ageCurve = { "34+": -3 };
      const w = build({ deep: { script: deepSide(0.5), baseline: base } });
      const c = chartByLabel(w, "Mean OVR change by age band over all seasons");
      expect(c.labels).toEqual(["25-27", "34+"]);
      expect(c.series[0].data).toEqual([null, -3]);
      expect(c.series[1].data).toEqual([1.5, -2.5]);
      expect(c.note.replace(/\s+/g, " ")).toBe("Averaged over all 2 seasons and 200 replicates.");
    });

    it("handles a script with no seasons or age bands", () => {
      const script = { ...deepSide(0), seasons: [], ageCurve: {} };
      const w = build({ deep: { script, baseline: null } });
      expect(w.findAll('[role="tab"]')[1].text()).toBe("Over N seasons");
      expect(chartByLabel(w, "League mean OVR after each offseason").labels).toEqual([]);
      expect(chartByLabel(w, "Mean OVR change by age band over all seasons").labels).toEqual([]);
    });
  });
});
