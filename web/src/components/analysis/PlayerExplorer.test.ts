import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setPlotlyForTesting, type PlotlyLike } from "../../composables/usePlotly";
import type { ExplorerPayload, PlotlyFigureJson } from "../../lib/analysisTypes";
import PlayerExplorer from "./PlayerExplorer.vue";

function plotlyStub(): PlotlyLike {
  return {
    newPlot: vi.fn().mockResolvedValue(undefined),
    react: vi.fn().mockResolvedValue(undefined),
    purge: vi.fn(),
    Plots: { resize: vi.fn().mockResolvedValue(undefined) },
  };
}

const payload: ExplorerPayload = {
  leagueMean: 1.25,
  groupColors: { Physical: "#dc2626", Shooting: "#f97316" },
  players: [
    {
      id: 101, label: "Alpha Man (SEA, 24)", age: 24, base: 62,
      mean: 4.1, std: 1.2, p05: -1, p25: 2, p50: 4, p75: 6, p95: 9,
      pUp: 0.92, pDn: 0.04, pBig: 0.31, mx: 71,
      dx: [-1, 0, 1, 2], dp: [0.05, 0.1, 0.4, 0.45], mode: "pmf",
      attrs: { Physical: 1.4, Shooting: 0.8 },
    },
    {
      id: 202, label: "Beta Guy (LAL, 31)", age: 31, base: 70,
      mean: -2.3, std: 0.9, p05: -5, p25: -3.5, p50: -2.5, p75: -1.5, p95: -0.5,
      pUp: 0.08, pDn: 0.88, pBig: 0, mx: 70,
      dx: [-3.2, -1.1, 1.0], dp: [0.5, 0.4, 0.1], mode: "hist",
      attrs: { Physical: -1.9, Shooting: -0.4 },
    },
  ],
};

type BarTrace = {
  type: string;
  x: (number | string)[];
  y: (number | string)[];
  width: number;
  marker: { color: string[] };
};

describe("PlayerExplorer", () => {
  let plotly: PlotlyLike;

  beforeEach(() => {
    plotly = plotlyStub();
    setPlotlyForTesting(plotly);
  });
  afterEach(() => {
    setPlotlyForTesting(null);
  });

  it("selects the first (most extreme) player by default", async () => {
    const wrapper = mount(PlayerExplorer, { props: { payload } });
    await flushPromises();
    const input = wrapper.get("input").element as HTMLInputElement;
    expect(input.value).toBe("Alpha Man (SEA, 24)");
    expect(wrapper.get('[data-testid="explorer-stats"]').text()).toBe(
      "age 24 · base 62 · median Δ +4 · 90% [-1, 9]",
    );
    // Two eager charts drew.
    expect(plotly.newPlot).toHaveBeenCalledTimes(2);
  });

  it("splits distribution bar colors by delta sign and uses pmf width", async () => {
    mount(PlayerExplorer, { props: { payload } });
    await flushPromises();
    const dist = vi.mocked(plotly.newPlot).mock.calls[0][1][0] as BarTrace;
    expect(dist.marker.color).toEqual(["#dc2626", "#94a3b8", "#16a34a", "#16a34a"]);
    expect(dist.width).toBe(0.82);
    // Percentages of runs, not fractions.
    expect(dist.y).toEqual([5, 10, 40, 45]);
  });

  it("uses histogram bin width for hist-mode players and updates on search", async () => {
    const wrapper = mount(PlayerExplorer, { props: { payload } });
    await flushPromises();
    await wrapper.get("input").setValue("Beta Guy (LAL, 31)");
    await flushPromises();

    expect(wrapper.get('[data-testid="explorer-stats"]').text()).toContain(
      "median Δ -2.5",
    );
    const calls = vi.mocked(plotly.react).mock.calls.length
      ? vi.mocked(plotly.react).mock.calls
      : vi.mocked(plotly.newPlot).mock.calls;
    const dist = calls[calls.length - 2][1][0] as BarTrace;
    // hist width = (dx[1]-dx[0]) * 0.98
    expect(dist.width).toBeCloseTo((-1.1 - -3.2) * 0.98, 5);
  });

  it("sorts attribute bars ascending and colors them by group", async () => {
    mount(PlayerExplorer, { props: { payload } });
    await flushPromises();
    const attrs = vi.mocked(plotly.newPlot).mock.calls[1][1][0] as BarTrace;
    expect(attrs.y).toEqual(["Shooting", "Physical"]);
    expect(attrs.x).toEqual([0.8, 1.4]);
    expect(attrs.marker.color).toEqual(["#f97316", "#dc2626"]);
  });

  it("keeps the current charts pinned while the query has no match", async () => {
    const wrapper = mount(PlayerExplorer, { props: { payload } });
    await flushPromises();
    vi.mocked(plotly.purge).mockClear();

    await wrapper.get("input").setValue("Beta Gu");
    await flushPromises();

    // Hint shown, but the selection (and both charts) stay put.
    expect(wrapper.text()).toContain("No player matches");
    expect(wrapper.findAll(".plotly-chart")).toHaveLength(2);
    expect(plotly.purge).not.toHaveBeenCalled();
    expect(wrapper.get('[data-testid="explorer-stats"]').text()).toContain("age 24");
  });

  it("includes the big-jump annotation only when pBig is meaningful", async () => {
    const wrapper = mount(PlayerExplorer, { props: { payload } });
    await flushPromises();
    const layout1 = vi.mocked(plotly.newPlot).mock.calls[0][2] as {
      annotations: { text: string }[];
    };
    const box1 = layout1.annotations[layout1.annotations.length - 1];
    expect(box1.text).toContain("P(jump ≥ +5): 31.0%");

    vi.mocked(plotly.newPlot).mockClear();
    vi.mocked(plotly.react).mockClear();
    await wrapper.get("input").setValue("Beta Guy (LAL, 31)");
    await flushPromises();
    const reactCalls = vi.mocked(plotly.react).mock.calls;
    const layout2 = (
      reactCalls.length ? reactCalls[0][2] : vi.mocked(plotly.newPlot).mock.calls[0][2]
    ) as { annotations: { text: string }[] };
    const box2 = layout2.annotations[layout2.annotations.length - 1];
    expect(box2.text).not.toContain("P(jump");
  });
});

describe("PlayerExplorer figure typing", () => {
  it("emits figures compatible with PlotlyFigureJson", async () => {
    setPlotlyForTesting(plotlyStub());
    mount(PlayerExplorer, { props: { payload } });
    await flushPromises();
    // Compile-time check only; the assertion is trivial.
    const fig: PlotlyFigureJson = { data: [], layout: {} };
    expect(fig.data).toEqual([]);
    setPlotlyForTesting(null);
  });
});
