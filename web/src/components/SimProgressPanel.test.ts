import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import SimProgressPanel from "./SimProgressPanel.vue";
import { MockEventSource, resetMockEventSource } from "../test/mockEventSource";

vi.mock("../lib/api", () => ({
  getApiBaseUrl: vi.fn(() => "/api"),
}));

describe("SimProgressPanel", () => {
  beforeEach(() => {
    resetMockEventSource();
    vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);
    vi.stubEnv("VITE_API_BASE_URL", "");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("renders live progress updates", async () => {
    const wrapper = mount(SimProgressPanel, {
      props: { build: "20260101120000" },
    });

    expect(wrapper.text()).toContain("Live Progress");
    expect(wrapper.text()).toContain("0%");

    MockEventSource.instances[0].emit({
      phase: "analyzing",
      pct: 87.2,
      message: "Generating analysis",
      done: false,
    });
    await nextTick();

    expect(wrapper.text()).toContain("87%");
    expect(wrapper.text()).toContain("Generating analysis");
    expect(wrapper.get(".h-full").attributes("style")).toContain("width: 87.2%");
  });
});
