import { mount, flushPromises, RouterLinkStub } from "@vue/test-utils";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import { ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import NewSimView, { PAIR_COMPLETE_TOAST } from "./NewSimView.vue";

vi.mock("../lib/api", () => ({
  createSim: vi.fn(),
}));

vi.mock("../composables/useSimProgress", () => ({
  useSimProgress: vi.fn(),
}));

vi.mock("../components/SimProgressPanel.vue", () => ({
  default: { name: "SimProgressPanel", template: "<div />" },
}));

import { createSim } from "../lib/api";
import { useSimProgress } from "../composables/useSimProgress";

type ProgressStub = ReturnType<typeof progressStub>;
function progressStub() {
  return { done: ref(false), phase: ref("idle"), pct: ref(0), message: ref("") };
}

/** Queue distinct progress stubs for the primary + baseline useSimProgress calls. */
function useProgress(primary: ProgressStub, baseline: ProgressStub) {
  vi.mocked(useSimProgress)
    .mockReturnValueOnce(primary)
    .mockReturnValueOnce(baseline);
}

beforeEach(() => {
  vi.mocked(useSimProgress).mockReset();
  vi.mocked(useSimProgress).mockImplementation(() => progressStub());
  vi.mocked(createSim).mockReset();
  vi.mocked(createSim).mockResolvedValue({ build: "20260101120000" });
});

afterEach(() => {
  vi.useRealTimers();
});

function mountView(): { wrapper: ReturnType<typeof mount>; router: Router } {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: { template: "<div />" } },
      { path: "/new", component: NewSimView },
      { path: "/runs/:build", component: { template: "<div />" } },
      { path: "/compare", component: { template: "<div />" } },
    ],
  });
  const wrapper = mount(NewSimView, {
    global: { plugins: [router], stubs: { RouterLink: RouterLinkStub } },
  });
  return { wrapper, router };
}

async function chooseExport(wrapper: ReturnType<typeof mount>) {
  const file = new File(["{}"], "export.json", { type: "application/json" });
  const input = wrapper.get("#export-file").element as HTMLInputElement;
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await wrapper.get("#export-file").trigger("change");
}

async function submitPaired(
  wrapper: ReturnType<typeof mount>,
  opts: { version?: "v41" | "v43" } = {},
) {
  vi.mocked(createSim).mockResolvedValue({
    build: "20260101120000",
    compare_build: "20260101120001",
    pair_id: "pair-1",
  } as never);
  await chooseExport(wrapper);
  if (opts.version) {
    await wrapper.get("#sim-version").setValue(opts.version);
  }
  await wrapper.get("form").trigger("submit");
  await flushPromises();
}

describe("NewSimView", () => {
  it("exports the exact ASCII paired-completion toast copy", () => {
    // Independent of the shared constant — guards against Unicode ellipsis drift.
    expect(PAIR_COMPLETE_TOAST).toBe(
      "Both runs saved to your dashboard. Opening the comparison results...",
    );
    expect(PAIR_COMPLETE_TOAST.includes("...")).toBe(true);
    expect(PAIR_COMPLETE_TOAST.includes("\u2026")).toBe(false);
  });

  it("renders the form and back navigation", () => {
    const { wrapper } = mountView();
    expect(wrapper.text()).toContain("New simulation");
    expect(wrapper.text()).toContain("Upload a BBGM export");
    expect(wrapper.text()).toContain("Start simulation");
  });

  it("defaults the progression version to v4.3", () => {
    const { wrapper } = mountView();
    const select = wrapper.get("#sim-version").element as HTMLSelectElement;
    expect(select.value).toBe("v43");
  });

  it("renders the compare toggle checked by default, naming the other version", () => {
    const { wrapper } = mountView();
    const checkbox = wrapper.get(".compare-toggle input").element as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    // v4.3 selected by default -> the other version is v4.1.
    expect(wrapper.get(".compare-toggle").text()).toContain("v4.1");
  });

  it("re-labels the compare toggle to name the other version for the selection", async () => {
    const { wrapper } = mountView();
    await wrapper.get("#sim-version").setValue("v41");
    expect(wrapper.get(".compare-toggle").text()).toContain("v4.3");
  });

  it("posts the chosen version when submitting", async () => {
    const { wrapper } = mountView();
    await chooseExport(wrapper);
    await wrapper.get("#sim-version").setValue("v41");
    await wrapper.get("form").trigger("submit");
    await flushPromises();

    expect(createSim).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createSim).mock.calls[0]![1]).toMatchObject({ version: "v41" });
  });

  it("submits compare:true and opens the comparison once both paired runs complete", async () => {
    vi.useFakeTimers();

    const primary = progressStub();
    const baseline = progressStub();
    useProgress(primary, baseline);

    const { wrapper, router } = mountView();
    await submitPaired(wrapper);

    expect(vi.mocked(createSim).mock.calls[0]![1]).toMatchObject({ compare: true });

    // Terminal alone is not enough — phase must be complete.
    primary.done.value = true;
    primary.phase.value = "complete";
    baseline.done.value = true;
    baseline.phase.value = "complete";
    await flushPromises();

    expect(wrapper.text()).toContain(
      "Both runs saved to your dashboard. Opening the comparison results...",
    );
    expect(router.currentRoute.value.path).not.toBe("/compare");

    vi.advanceTimersByTime(1500);
    await flushPromises();

    expect(router.currentRoute.value.path).toBe("/compare");
    expect(router.currentRoute.value.query.builds).toBe(
      "20260101120000,20260101120001",
    );
  });

  it("does not toast or navigate when primary fails and baseline completes", async () => {
    vi.useFakeTimers();
    const primary = progressStub();
    const baseline = progressStub();
    useProgress(primary, baseline);

    const { wrapper, router } = mountView();
    await submitPaired(wrapper);

    primary.done.value = true;
    primary.phase.value = "failed";
    await flushPromises();

    expect(wrapper.text()).toContain(
      "Comparison unavailable because the v4.3 run failed. You can still open either run from the links below.",
    );

    baseline.done.value = true;
    baseline.phase.value = "complete";
    await flushPromises();
    vi.advanceTimersByTime(2000);
    await flushPromises();

    expect(wrapper.text()).not.toContain(
      "Both runs saved to your dashboard. Opening the comparison results...",
    );
    expect(router.currentRoute.value.path).not.toBe("/compare");
    // Panels / run links remain.
    expect(wrapper.text()).toContain("20260101120000");
    expect(wrapper.text()).toContain("20260101120001");
  });

  it("does not toast or navigate when baseline fails and primary completes", async () => {
    vi.useFakeTimers();
    const primary = progressStub();
    const baseline = progressStub();
    useProgress(primary, baseline);

    const { wrapper, router } = mountView();
    await submitPaired(wrapper);

    primary.done.value = true;
    primary.phase.value = "complete";
    baseline.done.value = true;
    baseline.phase.value = "failed";
    await flushPromises();
    vi.advanceTimersByTime(2000);
    await flushPromises();

    expect(wrapper.text()).toContain(
      "Comparison unavailable because the v4.1 run failed. You can still open either run from the links below.",
    );
    expect(wrapper.text()).not.toContain(
      "Both runs saved to your dashboard. Opening the comparison results...",
    );
    expect(router.currentRoute.value.path).not.toBe("/compare");
  });

  it("shows the failure message while the sibling is still running", async () => {
    const primary = progressStub();
    const baseline = progressStub();
    useProgress(primary, baseline);

    const { wrapper, router } = mountView();
    await submitPaired(wrapper, { version: "v41" });

    primary.done.value = true;
    primary.phase.value = "failed";
    // baseline still running
    await flushPromises();

    expect(wrapper.text()).toContain(
      "Comparison unavailable because the v4.1 run failed. You can still open either run from the links below.",
    );
    expect(wrapper.text()).toContain("20260101120001");
    expect(router.currentRoute.value.path).not.toBe("/compare");
  });

  it("submits compare:false and routes to the single run's detail only on complete", async () => {
    vi.mocked(createSim).mockResolvedValue({ build: "20260101120000" });

    const primary = progressStub();
    const baseline = progressStub();
    useProgress(primary, baseline);

    const { wrapper, router } = mountView();
    await chooseExport(wrapper);
    await wrapper.get(".compare-toggle input").setValue(false);
    await wrapper.get("form").trigger("submit");
    await flushPromises();

    expect(vi.mocked(createSim).mock.calls[0]![1]).toMatchObject({ compare: false });

    // done alone must not navigate
    primary.done.value = true;
    await flushPromises();
    expect(router.currentRoute.value.path).not.toBe("/runs/20260101120000");

    primary.phase.value = "complete";
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/runs/20260101120000");
  });

  it("does not navigate when a single (compare-off) run fails", async () => {
    vi.mocked(createSim).mockResolvedValue({ build: "20260101120000" });

    const primary = progressStub();
    const baseline = progressStub();
    useProgress(primary, baseline);

    const { wrapper, router } = mountView();
    await chooseExport(wrapper);
    await wrapper.get(".compare-toggle input").setValue(false);
    await wrapper.get("form").trigger("submit");
    await flushPromises();

    primary.done.value = true;
    primary.phase.value = "failed";
    primary.message.value = "engine boom";
    await flushPromises();

    expect(router.currentRoute.value.path).not.toBe("/runs/20260101120000");
    expect(wrapper.text()).toContain("engine boom");
  });

  it("clears the paired failure banner on the next submit", async () => {
    const primary = progressStub();
    const baseline = progressStub();
    useProgress(primary, baseline);

    const { wrapper } = mountView();
    await submitPaired(wrapper);

    primary.done.value = true;
    primary.phase.value = "failed";
    await flushPromises();
    expect(wrapper.text()).toContain("Comparison unavailable because the v4.3 run failed");

    vi.mocked(createSim).mockResolvedValue({
      build: "20260101130000",
      compare_build: "20260101130001",
      pair_id: "pair-2",
    } as never);
    await wrapper.get("form").trigger("submit");
    await flushPromises();

    expect(wrapper.text()).not.toContain("Comparison unavailable");
  });
});
