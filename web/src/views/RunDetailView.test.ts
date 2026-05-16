import { mount, flushPromises, RouterLinkStub } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RunDetailView from "./RunDetailView.vue";
import type { RunMetadata } from "../lib/types";

vi.mock("../lib/api", () => ({
  fetchSim: vi.fn(),
  deleteSim: vi.fn(),
  downloadUrl: vi.fn(() => "/api/mock-download"),
}));

import { deleteSim, fetchSim } from "../lib/api";

vi.mock("../components/SimProgressPanel.vue", () => ({
  default: {
    name: "SimProgressPanel",
    template: `<div data-test="progress-panel"></div>`,
  },
}));

vi.mock("../components/ChartGallery.vue", () => ({
  default: {
    name: "ChartGallery",
    template: `<div data-test="chart-gallery"></div>`,
  },
}));

vi.mock("../components/PlayerTable.vue", () => ({
  default: {
    name: "PlayerTable",
    template: `<div data-test="player-table"></div>`,
  },
}));

vi.mock("../components/GodProgList.vue", () => ({
  default: {
    name: "GodProgList",
    template: `<div data-test="godprog-list"></div>`,
  },
}));

vi.mock("../components/StatusBadge.vue", () => ({
  default: {
    name: "StatusBadge",
    props: ["status"],
    template: `<span data-test="status-badge">{{ status }}</span>`,
  },
}));

function createRouterForBuild() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: { template: "<div />" } },
      { path: "/runs/:build", component: RunDetailView },
    ],
  });
}

describe("RunDetailView", () => {
  beforeEach(() => {
    vi.mocked(fetchSim).mockReset();
    vi.mocked(deleteSim).mockReset();
  });

  it("shows a loading state while the run is fetching", async () => {
    let resolveRun: (run: RunMetadata) => void = () => undefined;
    const pending = new Promise<RunMetadata>((resolve) => {
      resolveRun = resolve;
    });
    vi.mocked(fetchSim).mockReturnValueOnce(pending);

    const router = createRouterForBuild();
    await router.push("/runs/20260101120000");
    await router.isReady();

    const wrapper = mount(RunDetailView, {
      global: { plugins: [router] },
    });
    await flushPromises();

    expect(wrapper.text()).toContain("Loading run…");
    resolveRun({
      build: "20260101120000",
      status: "complete",
      teams: [],
    });
    await flushPromises();
  });

  it("renders completed run details", async () => {
    vi.mocked(fetchSim).mockResolvedValueOnce({
      build: "20260101120000",
      status: "complete",
      teams: ["BOS"],
      script_version: "v4.1.0",
    });

    const router = createRouterForBuild();
    await router.push("/runs/20260101120000");
    await router.isReady();

    const wrapper = mount(RunDetailView, {
      global: {
        plugins: [router],
        stubs: {
          RouterLink: RouterLinkStub,
        },
      },
    });
    await flushPromises();

    expect(wrapper.text()).toContain("Run summary");
    expect(wrapper.text()).toContain("complete");
    expect(wrapper.text()).toContain("v4.1.0");
    expect(wrapper.find('[data-test="progress-panel"]').exists()).toBe(false);
  });

  it("shows not found when metadata is missing", async () => {
    vi.mocked(fetchSim).mockRejectedValueOnce({ status: 404 });

    const router = createRouterForBuild();
    await router.push("/runs/20260101120000");
    await router.isReady();

    const wrapper = mount(RunDetailView, {
      global: {
        plugins: [router],
        stubs: {
          RouterLink: RouterLinkStub,
        },
      },
    });
    await flushPromises();

    expect(wrapper.text()).toContain("Run not found");
  });

  it("shows the invalid build error for 422 responses", async () => {
    vi.mocked(fetchSim).mockRejectedValueOnce({ status: 422 });

    const router = createRouterForBuild();
    await router.push("/runs/bad-build");
    await router.isReady();

    const wrapper = mount(RunDetailView, {
      global: {
        plugins: [router],
        stubs: {
          RouterLink: RouterLinkStub,
        },
      },
    });
    await flushPromises();

    expect(wrapper.text()).toContain("Invalid Run ID");
  });

  it("renders the progress panel for running runs", async () => {
    vi.mocked(fetchSim).mockResolvedValueOnce({
      build: "20260101120000",
      status: "running",
      teams: [],
      script_version: "v4.1.0",
    });

    const router = createRouterForBuild();
    await router.push("/runs/20260101120000");
    await router.isReady();

    const wrapper = mount(RunDetailView, {
      global: {
        plugins: [router],
        stubs: {
          RouterLink: RouterLinkStub,
        },
      },
    });
    await flushPromises();

    expect(wrapper.find('[data-test="progress-panel"]').exists()).toBe(true);
  });

  it("switches tabs to render charts, players, and god progs", async () => {
    vi.mocked(fetchSim).mockResolvedValueOnce({
      build: "20260101120000",
      status: "complete",
      teams: ["BOS"],
      script_version: "v4.1.0",
    });

    const router = createRouterForBuild();
    await router.push("/runs/20260101120000");
    await router.isReady();

    const wrapper = mount(RunDetailView, {
      global: {
        plugins: [router],
        stubs: {
          RouterLink: RouterLinkStub,
        },
      },
    });
    await flushPromises();

    const chartsTab = wrapper.findAll("button").find((button) => button.text() === "Charts");
    expect(chartsTab).toBeDefined();
    if (!chartsTab) {
      return;
    }
    await chartsTab.trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-test="chart-gallery"]').exists()).toBe(true);

    const playersTab = wrapper.findAll("button").find((button) => button.text() === "Players");
    expect(playersTab).toBeDefined();
    if (!playersTab) {
      return;
    }
    await playersTab.trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-test="player-table"]').exists()).toBe(true);

    const godprogsTab = wrapper.findAll("button").find((button) => button.text() === "God Progs");
    expect(godprogsTab).toBeDefined();
    if (!godprogsTab) {
      return;
    }
    await godprogsTab.trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-test="godprog-list"]').exists()).toBe(true);
  });

  it("deletes a run after confirmation and returns to the dashboard", async () => {
    vi.mocked(fetchSim).mockResolvedValueOnce({
      build: "20260101120000",
      status: "complete",
      teams: [],
      script_version: "v4.1.0",
    });
    vi.mocked(deleteSim).mockResolvedValueOnce({ ok: true });
    vi.stubGlobal("confirm", vi.fn(() => true));

    const router = createRouterForBuild();
    await router.push("/runs/20260101120000");
    await router.isReady();

    const wrapper = mount(RunDetailView, {
      global: {
        plugins: [router],
        stubs: {
          RouterLink: RouterLinkStub,
        },
      },
    });
    await flushPromises();

    const deleteButton = wrapper.findAll("button").find((button) => button.text() === "Delete");
    expect(deleteButton).toBeDefined();
    if (!deleteButton) {
      return;
    }

    await deleteButton.trigger("click");
    await flushPromises();

    expect(deleteSim).toHaveBeenCalledWith("20260101120000");
    expect(router.currentRoute.value.fullPath).toBe("/");
  });
});
