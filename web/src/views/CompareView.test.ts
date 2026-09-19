import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CompareView from "./CompareView.vue";
import type { CompareDataResponse } from "../lib/analysisTypes";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

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

function sampleCompareData(title = "Progression Script Comparison"): CompareDataResponse {
  return {
    schemaVersion: 1,
    engine: "python",
    builds: ["20260101120000", "20260102120000"],
    hero: { title, subtitle: "2 scripts" },
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

  it("rejects old comparison data as soon as navigation starts, while new metadata is pending", async () => {
    const oldData = deferred<CompareDataResponse>();
    const newMetadata = deferred<Awaited<ReturnType<typeof fetchSims>>>();
    vi.mocked(fetchCompareData).mockReturnValueOnce(oldData.promise);
    vi.mocked(fetchSims).mockResolvedValueOnce([]).mockReturnValueOnce(newMetadata.promise);
    const { router, wrapper } = await mountAt("?builds=20260101120000,20260102120000");
    await flushPromises();

    await router.push("/compare?builds=20260103120000,20260104120000");
    await flushPromises();
    expect(wrapper.text()).toContain("Generating comparison");
    oldData.resolve(sampleCompareData("Old A/B result"));
    await flushPromises();
    expect(wrapper.text()).not.toContain("Old A/B result");
    expect(wrapper.text()).toContain("Generating comparison");

    vi.mocked(fetchCompareData).mockResolvedValueOnce(sampleCompareData("Current C/D result"));
    newMetadata.resolve([]);
    await flushPromises();
    expect(wrapper.text()).toContain("Current C/D result");
    expect(fetchCompareData).toHaveBeenLastCalledWith(["20260103120000", "20260104120000"]);
  });

  it("ignores stale metadata failure after navigating to another comparison", async () => {
    const oldMetadata = deferred<Awaited<ReturnType<typeof fetchSims>>>();
    const currentMetadata = deferred<Awaited<ReturnType<typeof fetchSims>>>();
    vi.mocked(fetchSims).mockReturnValueOnce(oldMetadata.promise).mockReturnValueOnce(currentMetadata.promise);
    vi.mocked(fetchCompareData).mockResolvedValue(sampleCompareData("Current result"));
    const { router, wrapper } = await mountAt("?builds=20260101120000,20260102120000");
    await router.push("/compare?builds=20260103120000,20260104120000");
    await flushPromises();

    oldMetadata.reject(new Error("old metadata failed"));
    await flushPromises();
    expect(fetchCompareData).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("Generating comparison");

    currentMetadata.resolve([]);
    await flushPromises();
    expect(fetchCompareData).toHaveBeenCalledTimes(1);
    expect(fetchCompareData).toHaveBeenCalledWith(["20260103120000", "20260104120000"]);
    expect(wrapper.text()).toContain("Current result");
  });

  it("does not start an old comparison when its metadata arrives after navigation", async () => {
    const oldMetadata = deferred<Awaited<ReturnType<typeof fetchSims>>>();
    const currentMetadata = deferred<Awaited<ReturnType<typeof fetchSims>>>();
    vi.mocked(fetchSims).mockReturnValueOnce(oldMetadata.promise).mockReturnValueOnce(currentMetadata.promise);
    vi.mocked(fetchCompareData).mockResolvedValue(sampleCompareData());
    const { router } = await mountAt("?builds=20260101120000,20260102120000");
    await flushPromises();
    await router.push("/compare?builds=20260103120000,20260104120000");
    await flushPromises();
    oldMetadata.resolve([]);
    await flushPromises();
    expect(fetchCompareData).not.toHaveBeenCalled();
    currentMetadata.resolve([]);
    await flushPromises();
    expect(fetchCompareData).toHaveBeenCalledTimes(1);
    expect(fetchCompareData).toHaveBeenCalledWith(["20260103120000", "20260104120000"]);
  });

  it("clears completed data while the next metadata request loads", async () => {
    const nextMetadata = deferred<Awaited<ReturnType<typeof fetchSims>>>();
    vi.mocked(fetchCompareData).mockResolvedValueOnce(sampleCompareData("Completed A/B"));
    vi.mocked(fetchSims).mockResolvedValueOnce([]).mockReturnValueOnce(nextMetadata.promise);
    const { router, wrapper } = await mountAt("?builds=20260101120000,20260102120000");
    await flushPromises();
    expect(wrapper.text()).toContain("Completed A/B");
    await router.push("/compare?builds=20260103120000,20260104120000");
    await flushPromises();
    expect(wrapper.text()).not.toContain("Completed A/B");
    expect(wrapper.text()).toContain("Generating comparison");
    expect(wrapper.find("iframe").exists()).toBe(false);
    nextMetadata.resolve([]);
    vi.mocked(fetchCompareData).mockResolvedValueOnce(sampleCompareData("Current C/D"));
    await flushPromises();
    expect(wrapper.text()).toContain("Current C/D");
  });

  it("clears the old iframe fallback while the next metadata request loads", async () => {
    const nextMetadata = deferred<Awaited<ReturnType<typeof fetchSims>>>();
    vi.mocked(fetchCompareData).mockRejectedValueOnce(new Error("old failure"));
    vi.mocked(fetchSims).mockResolvedValueOnce([]).mockReturnValueOnce(nextMetadata.promise);
    const { router, wrapper } = await mountAt("?builds=20260101120000,20260102120000");
    await flushPromises();
    expect(wrapper.find("iframe").exists()).toBe(true);
    await router.push("/compare?builds=20260103120000,20260104120000");
    await flushPromises();
    expect(wrapper.find("iframe").exists()).toBe(false);
    expect(wrapper.text()).toContain("Generating comparison");
    nextMetadata.resolve([]);
    vi.mocked(fetchCompareData).mockResolvedValueOnce(sampleCompareData("Current C/D"));
    await flushPromises();
    expect(wrapper.text()).toContain("Current C/D");
  });

  it("invalidates an in-flight request when the query becomes too short", async () => {
    const oldData = deferred<CompareDataResponse>();
    vi.mocked(fetchCompareData).mockReturnValueOnce(oldData.promise);
    const { router, wrapper } = await mountAt("?builds=20260101120000,20260102120000");
    await flushPromises();
    await router.push("/compare?builds=20260103120000");
    await flushPromises();
    oldData.reject(new Error("old request failed"));
    await flushPromises();
    expect(wrapper.text()).toContain("Select at least two completed runs");
    expect(wrapper.text()).not.toContain("Generating comparison");
    expect(wrapper.find("iframe").exists()).toBe(false);
  });

  it("does not fetch comparison data if metadata returns after unmount", async () => {
    const metadata = deferred<Awaited<ReturnType<typeof fetchSims>>>();
    vi.mocked(fetchSims).mockReturnValueOnce(metadata.promise);
    const { wrapper } = await mountAt("?builds=20260101120000,20260102120000");
    await flushPromises();
    expect(fetchSims).toHaveBeenCalledTimes(1);
    wrapper.unmount();
    metadata.resolve([]);
    await flushPromises();
    expect(fetchCompareData).not.toHaveBeenCalled();
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

  it("orders a historical compact-ID pair with Published as the primary", async () => {
    vi.mocked(fetchCompareData).mockResolvedValue(sampleCompareData());
    vi.mocked(fetchSims).mockResolvedValue([
      { build: "20260101120000", status: "complete", teams: [], requested_version: "v321", pair_id: "old-pair", pair_role: "primary" },
      { build: "20260102120000", status: "complete", teams: [], requested_version: "v43", pair_id: "old-pair" },
    ]);
    const { wrapper } = await mountAt("?builds=20260102120000,20260101120000");
    await flushPromises();
    expect(wrapper.text()).toContain("Published vs Candidate");
    expect(wrapper.findAll(".compare-runs__role").map((n) => n.text())).toEqual(["Published", "Candidate"]);
    expect(fetchCompareData).toHaveBeenCalledWith(["20260101120000", "20260102120000"]);
  });

  it("uses script versions for a historical Published and Legacy pair", async () => {
    vi.mocked(fetchCompareData).mockResolvedValue(sampleCompareData());
    vi.mocked(fetchSims).mockResolvedValue([
      { build: "20260101120000", status: "complete", teams: [], script_version: "v41", pair_id: "old-pair" },
      { build: "20260102120000", status: "complete", teams: [], script_version: "v321", pair_id: "old-pair" },
    ]);
    const { wrapper } = await mountAt("?builds=20260101120000,20260102120000");
    await flushPromises();
    expect(wrapper.text()).toContain("Published vs Legacy");
    expect(fetchCompareData).toHaveBeenCalledWith(["20260102120000", "20260101120000"]);
  });

  it("does not assign Published to an unknown version", async () => {
    vi.mocked(fetchCompareData).mockResolvedValue(sampleCompareData());
    vi.mocked(fetchSims).mockResolvedValue([
      { build: "20260101120000", status: "complete", teams: [], requested_version: "foo321", pair_id: "pair" },
      { build: "20260102120000", status: "complete", teams: [], requested_version: "v43", pair_id: "pair" },
    ]);
    const { wrapper } = await mountAt("?builds=20260101120000,20260102120000");
    await flushPromises();
    expect(wrapper.text()).not.toContain("Published vs Candidate");
    expect(wrapper.findAll(".compare-runs__role").map((n) => n.text())).toEqual(["Candidate"]);
    expect(fetchCompareData).toHaveBeenCalledWith(["20260101120000", "20260102120000"]);
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
