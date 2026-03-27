import { mount, flushPromises } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RunDetailView from "./RunDetailView.vue";

vi.mock("../lib/api", () => ({
  fetchSim: vi.fn(() =>
    Promise.resolve({
      build: "20260101120000",
      status: "complete",
      teams: [],
    }),
  ),
}));

import { fetchSim } from "../lib/api";

describe("RunDetailView", () => {
  beforeEach(() => {
    vi.mocked(fetchSim).mockClear();
  });

  it("fetches run by route build id", async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/runs/:build", component: RunDetailView }],
    });
    await router.push("/runs/20260101120000");
    await router.isReady();
    mount(RunDetailView, {
      global: { plugins: [router] },
    });
    await flushPromises();
    expect(fetchSim).toHaveBeenCalledWith("20260101120000");
  });
});
