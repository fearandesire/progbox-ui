import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import LabChart, { type LabSeries } from "./LabChart.vue";
import { useTheme } from "../../composables/useTheme";

// chart.js needs a real canvas; stub the vue-chartjs wrappers and inspect what LabChart hands them.
vi.mock("vue-chartjs", () => {
  const stub = (name: string) => ({ name, props: { data: Object, options: Object }, template: `<canvas data-kind="${name}" />` });
  return { Bar: stub("Bar"), Line: stub("Line"), Scatter: stub("Scatter") };
});

type Opts = {
  interaction: { mode: string };
  plugins: { legend: { labels: { color: string } }; tooltip: { callbacks: { title: (items: unknown[]) => string; label: (item: unknown) => string } } };
  scales: { x: { type: string; title: { display: boolean; text: string } }; y: { ticks: { callback: (v: number | string) => string } } };
};
type Data = { labels?: string[]; datasets: { label: string; backgroundColor: string; borderWidth: number }[] };

const lineSeries: LabSeries[] = [
  { name: "net@3.2.1", role: "baseline", data: [47.1, null], se: [0.05, null] },
  { name: "net@4.3.0", role: "script", data: [47.6, 48.2], se: [0, 0.1] },
];

function chartProps(w: ReturnType<typeof mount>, name: string) {
  const c = w.findComponent({ name });
  return { data: c.props("data") as Data, options: c.props("options") as Opts };
}

describe("LabChart", () => {
  it("renders a line chart with baseline blue, script orange and SE tooltips", () => {
    const w = mount(LabChart, { props: { kind: "line", labels: [2026, 2027], series: lineSeries, yTitle: "Mean OVR", xTitle: "Season", digits: 2, signed: true, statgen: true, chartLabel: "League mean OVR" } });
    expect(w.find('[role="img"]').attributes("aria-label")).toBe("League mean OVR");
    expect(w.find(".lab-statgen").exists()).toBe(true);
    const { data, options } = chartProps(w, "Line");
    expect(data.labels).toEqual(["2026", "2027"]);
    expect(data.datasets.map((d) => [d.label, d.backgroundColor, d.borderWidth])).toEqual([["net@3.2.1", "#2563eb", 2], ["net@4.3.0", "#ea580c", 2]]);
    expect(options.interaction.mode).toBe("index");

    const { title, label } = options.plugins.tooltip.callbacks;
    expect(title([])).toBe("");
    expect(title([{ label: "2026", datasetIndex: 0, dataIndex: 0 }])).toBe("Season 2026");
    expect(label({ datasetIndex: 0, dataIndex: 0, parsed: { y: 47.1 } })).toBe("net@3.2.1: +47.10 ± 0.050 SE");
    expect(label({ datasetIndex: 1, dataIndex: 0, parsed: { y: -0.5 } })).toBe("net@4.3.0: -0.50");
    expect(label({ datasetIndex: 0, dataIndex: 1, parsed: { y: null } })).toBe("net@3.2.1: –");
    expect(options.scales.y.ticks.callback("1.5")).toBe("+1.50");
    expect(options.scales.y.ticks.callback(0)).toBe("0.00");
  });

  it("renders bars without an x title and shows a caption slot", () => {
    const w = mount(LabChart, { props: { kind: "bar", labels: ["25-27"], series: [lineSeries[1]!], yTitle: "Players", chartLabel: "Hist" }, slots: { default: "Bins of 1 OVR" } });
    expect(w.find(".lab-statgen").exists()).toBe(false);
    expect(w.find(".lab-caption").text()).toBe("Bins of 1 OVR");
    const { data, options } = chartProps(w, "Bar");
    expect(data.datasets[0]!.borderWidth).toBe(0);
    expect(options.scales.x).toMatchObject({ type: "category", title: { display: false } });
    expect(options.plugins.tooltip.callbacks.title([{ label: "25-27", datasetIndex: 0, dataIndex: 0 }])).toBe("25-27");
    expect(options.scales.y.ticks.callback(3)).toBe("3.0");
  });

  it("renders a scatter with per-point tips and x/y tooltip text", () => {
    const series: LabSeries[] = [{ name: "net@4.3.0", role: "script", data: [{ x: 18.25, y: 1.5 }], tips: ["Ann Able (27)"] }];
    const w = mount(LabChart, { props: { kind: "scatter", series, yTitle: "Mean ΔOVR", xTitle: "PER", digits: 2, signed: true, chartLabel: "PER" } });
    const { data, options } = chartProps(w, "Scatter");
    expect(data.labels).toBeUndefined();
    expect(data.datasets[0]!.backgroundColor).toBe("#ea580c99");
    expect(options.interaction.mode).toBe("nearest");
    expect(options.scales.x.type).toBe("linear");
    const { title, label } = options.plugins.tooltip.callbacks;
    expect(title([{ datasetIndex: 0, dataIndex: 0 }])).toBe("Ann Able (27)");
    expect(title([{ datasetIndex: 3, dataIndex: 0 }])).toBe("");
    expect(label({ datasetIndex: 0, dataIndex: 0, raw: { x: 18.25, y: 1.5 } })).toBe("net@4.3.0: PER 18.3, Mean ΔOVR +1.50");
  });

  it("switches axis text colour with the theme", async () => {
    const { theme } = useTheme();
    const before = theme.value;
    const w = mount(LabChart, { props: { kind: "bar", labels: ["a"], series: [lineSeries[1]!], yTitle: "Y", chartLabel: "c" } });
    theme.value = "light";
    await w.vm.$nextTick();
    const light = chartProps(w, "Bar").options.plugins.legend.labels.color;
    theme.value = "dark";
    await w.vm.$nextTick();
    expect(chartProps(w, "Bar").options.plugins.legend.labels.color).not.toBe(light);
    theme.value = before;
  });
});
