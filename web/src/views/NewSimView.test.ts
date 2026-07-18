import { mount, flushPromises, RouterLinkStub } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import NewSimView from "./NewSimView.vue";

vi.mock("../lib/api", () => ({
  createSim: vi.fn(() => Promise.resolve({ build: "20260101120000" })),
}));

vi.mock("../composables/useSimProgress", () => ({
  useSimProgress: () => ({ done: ref(false), phase: ref("idle"), pct: ref(0), message: ref("") }),
}));

vi.mock("../components/SimProgressPanel.vue", () => ({
  default: { name: "SimProgressPanel", template: "<div />" },
}));

import { createSim } from "../lib/api";

function mountView() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: { template: "<div />" } },
      { path: "/new", component: NewSimView },
      { path: "/runs/:build", component: { template: "<div />" } },
    ],
  });
  return mount(NewSimView, {
    global: { plugins: [router], stubs: { RouterLink: RouterLinkStub } },
  });
}

describe("NewSimView", () => {
  it("renders the form and back navigation", () => {
    const wrapper = mountView();
    expect(wrapper.text()).toContain("New simulation");
    expect(wrapper.text()).toContain("Upload a BBGM export");
    expect(wrapper.text()).toContain("Start simulation");
  });

  it("defaults the progression version to v4.3", () => {
    const wrapper = mountView();
    const select = wrapper.get("#sim-version").element as HTMLSelectElement;
    expect(select.value).toBe("v43");
  });

  it("posts the chosen version when submitting", async () => {
    const wrapper = mountView();

    const file = new File(["{}"], "export.json", { type: "application/json" });
    const input = wrapper.get("#export-file").element as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    await wrapper.get("#export-file").trigger("change");

    await wrapper.get("#sim-version").setValue("v41");
    await wrapper.get("form").trigger("submit");
    await flushPromises();

    expect(createSim).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createSim).mock.calls[0]![1]).toMatchObject({ version: "v41" });
  });
});
