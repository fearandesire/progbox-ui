import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CompareView from "./CompareView.vue";
import type { CompareDataResponse } from "../lib/analysisTypes";

vi.mock("../lib/api", () => ({
  fetchSims: vi.fn(),
  fetchCompareData: vi.fn(),
  compareUrl: (builds: string[]) =>
    `/api/sims/compare?builds=${encodeURIComponent(builds.join(","))}`,
}));

import { fetchCompareData, fetchSims } from "../lib/api";

vi.mock("../components/analysis/AnalysisDashboard.vue", () => ({
  default: {
    name: "AnalysisDashboard",
    props: ["data", "scorecard"],
    template: `<div data-test="analysis-dashboard">{{ data.hero.title }}</div>`,
  },
}));

vi.mock("../components/VersionChip.vue", () => ({
  default: {
    name: "VersionChip",
    props: ["version"],
    template: `<span data-test="version-chip">{{ version }}</span>`,
  },
}));

function sampleCompareData(): CompareDataResponse {
  return {
    schemaVersion: 1,
    engine: "python",
    builds: ["20260101120000", "20260102120000"],
    hero: { title: "Progression Script Comparison", subtitle: "2 scripts" },
    statCards: [{ label: "Scripts", value: "2", color: null }],
    sections: [
      { id: "scorecard", title: "§1 · Scorecard", intro: "KPIs.", charts: [] },
    ],
    figures: {},
    playerExplorer: null,
    scorecard: { scripts: ["a", "b"], colors: ["#2563eb", "#dc2626"], metrics: [] },
  };
}

async function mountAt(query: string): Promise<{ router: Router; wrapper: ReturnType<typeof mount> }> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: { template: "<div />" } },
      { path: "/compare", component: CompareView },
    ],
  });
  await router.push(`/compare${query}`);
  await router.isReady();
  const wrapper = mount(CompareView, {
    global: { plugins: [router] },
  });
  return { router, wrapper };
}

describe("CompareView", () => {
  beforeEach(() => {
    vi.mocked(fetchSims).mockReset();
    vi.mocked(fetchCompareData).mockReset();
    vi.mocked(fetchSims).mockResolvedValue([]);
  });

  it("prompts for at least two builds when the query is short", async () => {
    const { wrapper } = await mountAt("?builds=20260101120000");
    expect(wrapper.text()).toContain("Select at least two completed runs");
    expect(fetchCompareData).not.toHaveBeenCalled();
  });

  it("fetches comparison data and renders the native dashboard", async () => {
    vi.mocked(fetchCompareData).mockResolvedValue(sampleCompareData());
    const { wrapper } = await mountAt("?builds=20260101120000,20260102120000");
    await flushPromises();

    expect(fetchCompareData).toHaveBeenCalledWith([
      "20260101120000",
      "20260102120000",
    ]);
    expect(wrapper.find('[data-test="analysis-dashboard"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("Progression Script Comparison");
    expect(wrapper.find("iframe").exists()).toBe(false);
  });

  it("shows the generating state while the request is in flight", async () => {
    let resolve!: (v: CompareDataResponse) => void;
    vi.mocked(fetchCompareData).mockReturnValue(
      new Promise<CompareDataResponse>((r) => {
        resolve = r;
      }),
    );
    const { wrapper } = await mountAt("?builds=20260101120000,20260102120000");
    // loadRuns resolves first; then compare fetch starts and shows the spinner.
    await flushPromises();
    expect(wrapper.text()).toContain("Generating comparison");
    resolve(sampleCompareData());
    await flushPromises();
    expect(wrapper.text()).not.toContain("Generating comparison");
  });

  it("falls back to the iframe when the fetch fails", async () => {
    vi.mocked(fetchCompareData).mockRejectedValue(new Error("500"));
    const { wrapper } = await mountAt("?builds=20260101120000,20260102120000");
    await flushPromises();

    expect(wrapper.text()).toContain("Native comparison unavailable");
    expect(wrapper.get("iframe").attributes("src")).toBe(
      "/api/sims/compare?builds=20260101120000%2C20260102120000",
    );
  });

  it("shows Published vs Candidate when a published pair is loaded", async () => {
    vi.mocked(fetchCompareData).mockResolvedValue(sampleCompareData());
    vi.mocked(fetchSims).mockResolvedValue([
      {
        build: "20260101120000",
        status: "complete",
        teams: [],
        requested_version: "v4.3",
        pair_id: "pair-1",
      },
      {
        build: "20260102120000",
        status: "complete",
        teams: [],
        requested_version: "v3.2.1",
        pair_id: "pair-1",
      },
    ] as never);
    // Candidate first in the query — UI should still put Published first for chips + fetch.
    const { wrapper } = await mountAt("?builds=20260101120000,20260102120000");
    await flushPromises();

    expect(wrapper.text()).toContain("Published vs Candidate");
    expect(wrapper.text()).toContain("what leagues run today");
    expect(wrapper.text()).toContain("proposed release");
    const roles = wrapper.findAll(".compare-runs__role").map((n) => n.text());
    expect(roles[0]).toBe("Published");
    expect(roles[1]).toBe("Candidate");
    expect(fetchCompareData).toHaveBeenCalledWith([
      "20260102120000",
      "20260101120000",
    ]);
  });

  it("shows Published vs Legacy for a published+legacy pair", async () => {
    vi.mocked(fetchCompareData).mockResolvedValue(sampleCompareData());
    vi.mocked(fetchSims).mockResolvedValue([
      {
        build: "20260101120000",
        status: "complete",
        teams: [],
        requested_version: "v4.1",
        pair_id: "pair-legacy",
      },
      {
        build: "20260102120000",
        status: "complete",
        teams: [],
        requested_version: "v3.2.1",
        pair_id: "pair-legacy",
      },
    ] as never);
    const { wrapper } = await mountAt("?builds=20260101120000,20260102120000");
    await flushPromises();

    expect(wrapper.text()).toContain("Published vs Legacy");
    expect(wrapper.text()).not.toContain("Published vs Candidate");
    expect(wrapper.text()).toContain("older research fork");
    const roles = wrapper.findAll(".compare-runs__role").map((n) => n.text());
    expect(roles[0]).toBe("Published");
    expect(roles[1]).toBe("Legacy");
  });

  it("links the escape hatch to the original comparison HTML", async () => {
    vi.mocked(fetchCompareData).mockResolvedValue(sampleCompareData());
    const { wrapper } = await mountAt("?builds=20260101120000,20260102120000");
    await flushPromises();

    const link = wrapper.get('a[target="_blank"]');
    expect(link.attributes("href")).toBe(
      "/api/sims/compare?builds=20260101120000%2C20260102120000",
    );
  });
});
