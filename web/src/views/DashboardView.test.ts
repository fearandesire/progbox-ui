import { mount, RouterLinkStub, flushPromises } from "@vue/test-utils";
import { nextTick, reactive } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DashboardView from "./DashboardView.vue";
import { deleteSim } from "../lib/api";
import type { RunMetadata } from "../lib/types";

const mockRouterPush = vi.hoisted(() => vi.fn());

const mockSimsStore = reactive({
  runs: [] as RunMetadata[],
  loading: false,
  error: null as string | null,
  load: vi.fn(async () => undefined),
});

vi.mock("../stores/sims", () => ({
  useSimsStore: () => mockSimsStore,
}));

vi.mock("vue-router", async () => {
  const actual = await vi.importActual<typeof import("vue-router")>(
    "vue-router",
  );
  return {
    ...actual,
    useRouter: () => ({ push: mockRouterPush }),
  };
});

vi.mock("../lib/api", () => ({
  fetchPlayers: vi.fn().mockResolvedValue([]),
  fetchGodprogs: vi.fn().mockResolvedValue([]),
  deleteSim: vi.fn().mockResolvedValue(undefined),
}));

describe("DashboardView", () => {
  beforeEach(() => {
    mockSimsStore.runs = [];
    mockSimsStore.loading = false;
    mockSimsStore.error = null;
    mockSimsStore.load.mockClear();
    vi.mocked(deleteSim).mockClear();
    mockRouterPush.mockClear();
  });

  it("shows a loading state while the store is loading", async () => {
    mockSimsStore.loading = true;

    const wrapper = mount(DashboardView, {
      global: {
        stubs: {
          RouterLink: RouterLinkStub,
        },
      },
    });
    await nextTick();

    expect(wrapper.text()).toContain("Loading simulations…");
    expect(mockSimsStore.load).toHaveBeenCalledTimes(1);
  });

  it("shows an empty state when there are no runs", async () => {
    const wrapper = mount(DashboardView, {
      global: {
        stubs: {
          RouterLink: RouterLinkStub,
        },
      },
    });
    await flushPromises();

    expect(wrapper.text()).toContain("No simulations yet");
  });

  it("shows an error state when the store fails", async () => {
    mockSimsStore.error = "failed to load runs";

    const wrapper = mount(DashboardView, {
      global: {
        stubs: {
          RouterLink: RouterLinkStub,
        },
      },
    });
    await flushPromises();

    expect(wrapper.text()).toContain("failed to load runs");
  });

  it("renders run links when runs are present", async () => {
    mockSimsStore.runs = [
      { build: "20260101120000", status: "complete", teams: [] },
      { build: "20260102120000", status: "running", teams: [] },
    ];

    const wrapper = mount(DashboardView, {
      global: {
        stubs: {
          RouterLink: RouterLinkStub,
        },
      },
    });
    await flushPromises();

    expect(wrapper.text()).toContain("20260101120000");
    expect(wrapper.text()).toContain("running");
  });

  it("deletes a run after confirmation and reloads the dashboard", async () => {
    mockSimsStore.runs = [
      { build: "20260101120000", status: "complete", teams: [] },
    ];
    vi.spyOn(window, "confirm").mockReturnValue(true);

    const wrapper = mount(DashboardView, {
      global: {
        stubs: {
          RouterLink: RouterLinkStub,
        },
      },
    });
    await flushPromises();

    await wrapper
      .get('button[aria-label="Delete run 20260101120000"]')
      .trigger("click");
    await flushPromises();

    expect(deleteSim).toHaveBeenCalledWith("20260101120000");
    expect(mockSimsStore.load).toHaveBeenCalledTimes(2);
  });
});
