import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchAnalysisData } from "../lib/api";
import type { AnalysisDataResponse } from "../lib/analysisTypes";
import { setPlotlyForTesting, type PlotlyLike } from "../composables/usePlotly";
import ChartGallery from "./ChartGallery.vue";

vi.mock("../lib/api", () => ({
  getApiBaseUrl: vi.fn(() => "/api"),
  analysisHtmlUrl: (build: string) =>
    `/api/sims/${encodeURIComponent(build)}/analysis`,
  fetchAnalysisData: vi.fn(),
}));

function sampleData(): AnalysisDataResponse {
  return {
    schemaVersion: 1,
    engine: "python",
    build: "20260101120000",
    hero: { title: "Monte Carlo Tuning Dashboard", subtitle: "script: v4.3" },
    statCards: [
      { label: "Players", value: "359", color: null },
      { label: "Convergence", value: "98%", color: "#16a34a" },
    ],
    sections: [
      {
        id: "league-health",
        title: "§1 · League Health",
        intro: "Macro view.",
        charts: [{ kind: "figure", payloadId: "payload-1", minHeight: 450 }],
      },
    ],
    figures: {
      "payload-1": { data: [{ type: "scatter", x: [1], y: [2] }], layout: {} },
    },
    playerExplorer: null,
  };
}

function plotlyStub(): PlotlyLike {
  return {
    newPlot: vi.fn().mockResolvedValue(undefined),
    react: vi.fn().mockResolvedValue(undefined),
    purge: vi.fn(),
    Plots: { resize: vi.fn().mockResolvedValue(undefined) },
  };
}

describe("ChartGallery", () => {
  beforeEach(() => {
    vi.mocked(fetchAnalysisData).mockReset();
    setPlotlyForTesting(plotlyStub());
  });

  it("fetches analysis data and renders the native dashboard", async () => {
    vi.mocked(fetchAnalysisData).mockResolvedValue(sampleData());
    const wrapper = mount(ChartGallery, {
      props: { build: "20260101120000", analysisEngine: "python" },
    });
    await flushPromises();

    expect(fetchAnalysisData).toHaveBeenCalledWith("20260101120000");
    expect(wrapper.find("iframe").exists()).toBe(false);
    expect(wrapper.text()).toContain("Monte Carlo Tuning Dashboard");
    expect(wrapper.text()).toContain("§1 · League Health");
    expect(wrapper.find(".fallback-notice").exists()).toBe(false);
  });

  it("keeps the iframe (and notice) for fallback-engine runs without fetching", async () => {
    const wrapper = mount(ChartGallery, {
      props: { build: "20260101120000", analysisEngine: "fallback" },
    });
    await flushPromises();

    expect(fetchAnalysisData).not.toHaveBeenCalled();
    expect(wrapper.find(".fallback-notice").exists()).toBe(true);
    expect(wrapper.text()).toContain("Full interactive dashboard unavailable");
    const iframe = wrapper.get("iframe");
    expect(iframe.attributes("src")).toBe("/api/sims/20260101120000/analysis");
  });

  it("falls back to the iframe when the data fetch fails", async () => {
    vi.mocked(fetchAnalysisData).mockRejectedValue(new Error("409 Conflict"));
    const wrapper = mount(ChartGallery, {
      props: { build: "20260101120000", analysisEngine: "python" },
    });
    await flushPromises();

    expect(wrapper.get("iframe").attributes("src")).toBe(
      "/api/sims/20260101120000/analysis",
    );
    expect(wrapper.text()).toContain("Native dashboard unavailable");
  });

  it("exposes the escape hatch link to the original dashboard", async () => {
    vi.mocked(fetchAnalysisData).mockResolvedValue(sampleData());
    const wrapper = mount(ChartGallery, {
      props: { build: "20260101120000", analysisEngine: "python" },
    });
    await flushPromises();

    const link = wrapper.get('a[target="_blank"]');
    expect(link.attributes("href")).toBe("/api/sims/20260101120000/analysis");
    expect(link.attributes("rel")).toContain("noopener");
  });

  it("requests fullscreen on the native container when the button is clicked", async () => {
    vi.mocked(fetchAnalysisData).mockResolvedValue(sampleData());
    const wrapper = mount(ChartGallery, {
      props: { build: "20260101120000", analysisEngine: "python" },
    });
    await flushPromises();

    const container = wrapper.get(".chart-gallery__native").element as HTMLElement;
    const requestFullscreen = vi.fn();
    container.requestFullscreen = requestFullscreen;

    await wrapper.get('[aria-label="View dashboard fullscreen"]').trigger("click");
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
  });

  it("requests fullscreen on the iframe in fallback mode", async () => {
    const wrapper = mount(ChartGallery, {
      props: { build: "20260101120000", analysisEngine: "fallback" },
    });
    const iframe = wrapper.get("iframe").element as HTMLIFrameElement;
    const requestFullscreen = vi.fn();
    iframe.requestFullscreen = requestFullscreen;

    await wrapper.get('[aria-label="View dashboard fullscreen"]').trigger("click");
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
  });

  it("refetches when the build changes", async () => {
    vi.mocked(fetchAnalysisData).mockResolvedValue(sampleData());
    const wrapper = mount(ChartGallery, {
      props: { build: "20260101120000", analysisEngine: "python" },
    });
    await flushPromises();
    await wrapper.setProps({ build: "20260102120000" });
    await flushPromises();
    expect(fetchAnalysisData).toHaveBeenCalledTimes(2);
    expect(fetchAnalysisData).toHaveBeenLastCalledWith("20260102120000");
  });
});
