import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, nextTick } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSimProgress } from "./useSimProgress";
import { MockEventSource, resetMockEventSource } from "../test/mockEventSource";

vi.mock("../lib/api", () => ({
  getApiBaseUrl: vi.fn(() => "/api"),
}));

const ProgressHarness = defineComponent({
  name: "ProgressHarness",
  props: {
    build: {
      type: String,
      required: true,
    },
  },
  setup(props) {
    return useSimProgress(props.build);
  },
  template: `
    <div>
      <span data-test="phase">{{ phase }}</span>
      <span data-test="pct">{{ pct }}</span>
      <span data-test="message">{{ message }}</span>
      <span data-test="done">{{ done }}</span>
    </div>
  `,
});

describe("useSimProgress", () => {
  beforeEach(() => {
    resetMockEventSource();
    vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);
    vi.stubEnv("VITE_API_BASE_URL", "");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("connects to the API progress endpoint and updates from messages", async () => {
    const wrapper = mount(ProgressHarness, {
      props: { build: "20260101120000" },
    });

    expect(MockEventSource.instances).toHaveLength(1);
    expect(new URL(MockEventSource.instances[0].url).pathname).toBe(
      "/api/sims/20260101120000/progress",
    );

    MockEventSource.instances[0].emit({
      phase: "simulating",
      pct: 42.5,
      message: "Working",
      done: false,
    });
    await nextTick();

    expect(wrapper.get('[data-test="phase"]').text()).toBe("simulating");
    expect(wrapper.get('[data-test="pct"]').text()).toBe("42.5");
    expect(wrapper.get('[data-test="message"]').text()).toBe("Working");
    expect(wrapper.get('[data-test="done"]').text()).toBe("false");
  });

  it("ignores malformed payloads", async () => {
    const wrapper = mount(ProgressHarness, {
      props: { build: "20260101120000" },
    });

    MockEventSource.instances[0].emitRaw("not-json");
    await flushPromises();

    expect(wrapper.vm.phase).toBeNull();
    expect(wrapper.vm.pct).toBe(0);
    expect(wrapper.vm.message).toBeNull();
    expect(wrapper.vm.done).toBe(false);
  });

  it("closes the stream when a done payload arrives", async () => {
    const wrapper = mount(ProgressHarness, {
      props: { build: "20260101120000" },
    });

    MockEventSource.instances[0].emit({
      phase: "complete",
      pct: 100,
      message: "Done",
      done: true,
    });
    await nextTick();

    expect(wrapper.vm.done).toBe(true);
    expect(MockEventSource.instances[0].close).toHaveBeenCalledTimes(1);
  });

  it("closes the stream when an error occurs", async () => {
    const wrapper = mount(ProgressHarness, {
      props: { build: "20260101120000" },
    });

    MockEventSource.instances[0].fail();
    await nextTick();

    expect(MockEventSource.instances[0].close).toHaveBeenCalledTimes(1);
    expect(wrapper.vm.done).toBe(false);
  });
});
