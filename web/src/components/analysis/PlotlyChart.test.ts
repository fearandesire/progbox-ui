import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { setPlotlyForTesting, type PlotlyLike } from "../../composables/usePlotly";
import { useTheme } from "../../composables/useTheme";
import PlotlyChart from "./PlotlyChart.vue";

type ObserverCallback = (entries: { isIntersecting: boolean }[]) => void;

let observerCallbacks: ObserverCallback[];
let observed: Element[];

class FakeIntersectionObserver {
  constructor(cb: ObserverCallback) {
    observerCallbacks.push(cb);
  }
  observe(el: Element) {
    observed.push(el);
  }
  disconnect() {}
  unobserve() {}
}

function makePlotlyStub(): PlotlyLike {
  return {
    newPlot: vi.fn().mockResolvedValue(undefined),
    react: vi.fn().mockResolvedValue(undefined),
    purge: vi.fn(),
    Plots: { resize: vi.fn().mockResolvedValue(undefined) },
  };
}

const FIGURE = {
  data: [{ type: "scatter", x: [1], y: [2] }],
  layout: { height: 450, title: { text: "t" } },
};

describe("PlotlyChart", () => {
  let plotly: PlotlyLike;

  beforeEach(() => {
    observerCallbacks = [];
    observed = [];
    plotly = makePlotlyStub();
    setPlotlyForTesting(plotly);
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
    // Ensure a deterministic light theme regardless of test order.
    const { theme } = useTheme();
    theme.value = "light";
  });

  afterEach(() => {
    setPlotlyForTesting(null);
    vi.unstubAllGlobals();
  });

  it("reserves min-height and defers rendering until intersecting", async () => {
    const wrapper = mount(PlotlyChart, {
      props: { figure: FIGURE, minHeight: 520 },
    });
    expect(wrapper.get(".plotly-chart").attributes("style")).toContain("520px");
    expect(observed).toHaveLength(1);
    expect(plotly.newPlot).not.toHaveBeenCalled();

    observerCallbacks[0]([{ isIntersecting: true }]);
    await flushPromises();
    expect(plotly.newPlot).toHaveBeenCalledTimes(1);
    const [, data, layout, config] = vi.mocked(plotly.newPlot).mock.calls[0];
    expect(data).toEqual(FIGURE.data);
    expect((layout as { title: { text: string } }).title.text).toBe("t");
    expect((config as { displayModeBar: boolean }).displayModeBar).toBe(false);
  });

  it("renders immediately when eager", async () => {
    mount(PlotlyChart, { props: { figure: FIGURE, eager: true } });
    await flushPromises();
    expect(plotly.newPlot).toHaveBeenCalledTimes(1);
  });

  it("re-themes with Plotly.react when the theme flips", async () => {
    const { theme } = useTheme();
    mount(PlotlyChart, { props: { figure: FIGURE, eager: true } });
    await flushPromises();

    theme.value = "dark";
    await nextTick();
    await flushPromises();
    expect(plotly.react).toHaveBeenCalledTimes(1);

    theme.value = "light";
    await nextTick();
    await flushPromises();
    expect(plotly.react).toHaveBeenCalledTimes(2);
  });

  it("does not react before the initial render happened", async () => {
    const { theme } = useTheme();
    mount(PlotlyChart, { props: { figure: FIGURE } });
    theme.value = "dark";
    await nextTick();
    await flushPromises();
    expect(plotly.react).not.toHaveBeenCalled();
  });

  it("purges the plot on unmount", async () => {
    const wrapper = mount(PlotlyChart, { props: { figure: FIGURE, eager: true } });
    await flushPromises();
    wrapper.unmount();
    expect(plotly.purge).toHaveBeenCalledTimes(1);
  });
});
