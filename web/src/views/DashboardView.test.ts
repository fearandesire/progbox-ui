import { mount, RouterLinkStub, flushPromises } from "@vue/test-utils";
import { nextTick, reactive } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DashboardView from "./DashboardView.vue";
import type { RunMetadata } from "../lib/types";

const mockSimsStore = reactive({
  runs: [] as RunMetadata[],
  loading: false,
  error: null as string | null,
  load: vi.fn(async () => undefined),
});

vi.mock("../stores/sims", () => ({
  useSimsStore: () => mockSimsStore,
}));

describe("DashboardView", () => {
  beforeEach(() => {
    mockSimsStore.runs = [];
    mockSimsStore.loading = false;
    mockSimsStore.error = null;
    mockSimsStore.load.mockClear();
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

    expect(wrapper.text()).toContain("Loading…");
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

    expect(wrapper.text()).toContain("No runs yet");
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
});
