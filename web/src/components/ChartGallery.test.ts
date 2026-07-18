import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getApiBaseUrl } from "../lib/api";
import ChartGallery from "./ChartGallery.vue";

vi.mock("../lib/api", () => ({
  getApiBaseUrl: vi.fn(() => "/api"),
}));

describe("ChartGallery", () => {
  beforeEach(() => {
    vi.mocked(getApiBaseUrl).mockReset();
    vi.mocked(getApiBaseUrl).mockReturnValue("/api");
  });

  it("renders the analysis report iframe", () => {
    const wrapper = mount(ChartGallery, {
      props: { build: "20260101120000" },
    });

    const iframe = wrapper.get("iframe");
    expect(iframe.attributes("title")).toBe("Analysis Report");
    expect(iframe.attributes("src")).toBe("/api/sims/20260101120000/analysis");
  });

  it("uses the configured API base URL and encodes the build id", () => {
    vi.mocked(getApiBaseUrl).mockReturnValue("http://127.0.0.1:8000/api");

    const wrapper = mount(ChartGallery, {
      props: { build: "2026 01/01" },
    });

    expect(wrapper.get("iframe").attributes("src")).toBe(
      "http://127.0.0.1:8000/api/sims/2026%2001%2F01/analysis",
    );
  });

  it("shows a fallback notice when the analysis engine fell back", () => {
    const wrapper = mount(ChartGallery, {
      props: { build: "20260101120000", analysisEngine: "fallback" },
    });
    expect(wrapper.find(".fallback-notice").exists()).toBe(true);
    expect(wrapper.text()).toContain("Full interactive dashboard unavailable");
  });

  it("shows no notice for a real Python dashboard or legacy runs", () => {
    const python = mount(ChartGallery, {
      props: { build: "20260101120000", analysisEngine: "python" },
    });
    expect(python.find(".fallback-notice").exists()).toBe(false);

    const legacy = mount(ChartGallery, { props: { build: "20260101120000" } });
    expect(legacy.find(".fallback-notice").exists()).toBe(false);
  });
});
