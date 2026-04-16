import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import GodProgList from "./GodProgList.vue";

vi.mock("../lib/api", () => ({
  fetchGodprogs: vi.fn(),
}));

import { fetchGodprogs } from "../lib/api";

describe("GodProgList", () => {
  beforeEach(() => {
    vi.mocked(fetchGodprogs).mockReset();
  });

  it("renders formatted god prog rows", async () => {
    vi.mocked(fetchGodprogs).mockResolvedValueOnce([
      {
        name: "Future Star",
        age: 19,
        ovr: 74,
        bonus: 1.2345,
        chance: 0.45678,
        run_seed: 12345,
      },
    ]);

    const wrapper = mount(GodProgList, {
      props: { build: "20260101120000" },
    });
    await flushPromises();

    expect(fetchGodprogs).toHaveBeenCalledWith("20260101120000");
    expect(wrapper.text()).toContain("Future Star");
    expect(wrapper.text()).toContain("1.23");
    expect(wrapper.text()).toContain("0.4568");
    expect(wrapper.text()).toContain("12345");
  });

  it("shows an error and retries loading", async () => {
    vi.mocked(fetchGodprogs)
      .mockRejectedValueOnce(new Error("god progs unavailable"))
      .mockResolvedValueOnce([]);

    const wrapper = mount(GodProgList, {
      props: { build: "20260101120000" },
    });
    await flushPromises();

    expect(wrapper.text()).toContain("god progs unavailable");

    const retryButton = wrapper.findAll("button").find((button) => button.text() === "Retry");
    expect(retryButton).toBeDefined();
    if (!retryButton) {
      return;
    }

    await retryButton.trigger("click");
    await flushPromises();

    expect(fetchGodprogs).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).toContain("No god progs recorded.");
  });
});
