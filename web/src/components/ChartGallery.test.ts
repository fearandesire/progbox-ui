import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ChartGallery from "./ChartGallery.vue";

vi.mock("../lib/api", () => ({
  chartUrl: vi.fn((build: string, name: string) => `/api/sims/${build}/charts/${name}`),
  fetchCharts: vi.fn(),
}));

import { fetchCharts } from "../lib/api";

describe("ChartGallery", () => {
  beforeEach(() => {
    vi.mocked(fetchCharts).mockReset();
  });

  it("renders charts and opens the preview modal", async () => {
    vi.mocked(fetchCharts).mockResolvedValueOnce(["trend.png", "distribution.png"]);

    const wrapper = mount(ChartGallery, {
      props: { build: "20260101120000" },
    });
    await flushPromises();

    expect(fetchCharts).toHaveBeenCalledWith("20260101120000");
    expect(wrapper.text()).toContain("trend.png");
    expect(wrapper.text()).toContain("distribution.png");

    const chartButton = wrapper.findAll("button")[0];
    await chartButton.trigger("click");
    await flushPromises();

    const modal = wrapper.find(".fixed");
    expect(modal.exists()).toBe(true);
    expect(modal.text()).toContain("trend.png");

    const closeButton = wrapper.findAll("button").find((button) => button.text() === "Close");
    expect(closeButton).toBeDefined();
    if (!closeButton) {
      return;
    }

    await closeButton.trigger("click");
    await flushPromises();

    expect(wrapper.find(".fixed").exists()).toBe(false);
  });

  it("shows an error and retries loading", async () => {
    vi.mocked(fetchCharts)
      .mockRejectedValueOnce(new Error("charts unavailable"))
      .mockResolvedValueOnce([]);

    const wrapper = mount(ChartGallery, {
      props: { build: "20260101120000" },
    });
    await flushPromises();

    expect(wrapper.text()).toContain("charts unavailable");

    const retryButton = wrapper.findAll("button").find((button) => button.text() === "Retry");
    expect(retryButton).toBeDefined();
    if (!retryButton) {
      return;
    }

    await retryButton.trigger("click");
    await flushPromises();

    expect(fetchCharts).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).toContain("No charts yet.");
  });
});
