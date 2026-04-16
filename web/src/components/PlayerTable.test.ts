import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PlayerTable from "./PlayerTable.vue";

vi.mock("../lib/api", () => ({
  fetchPlayers: vi.fn(),
}));

import { fetchPlayers } from "../lib/api";

describe("PlayerTable", () => {
  beforeEach(() => {
    vi.mocked(fetchPlayers).mockReset();
  });

  it("renders players, toggles sorting, and applies filters", async () => {
    vi.mocked(fetchPlayers).mockResolvedValueOnce([
      {
        PlayerID: 1,
        Name: "Alice Example",
        Team: "BOS",
        Age: 31,
        Baseline: 50.123,
        MeanDelta: 2.5,
        StdDelta: 1.111,
        P05: 40,
        P25: 48,
        P50: 60.12,
        P75: 65,
        P95: 70.5,
      },
      {
        PlayerID: 2,
        Name: "Bob Example",
        Team: "NYK",
        Age: 19,
        Baseline: 44.2,
        MeanDelta: 1.2,
        StdDelta: 0.876,
        P05: 35,
        P25: 43,
        P50: 52.5,
        P75: 58,
        P95: 64.25,
      },
    ]);

    const wrapper = mount(PlayerTable, {
      props: { build: "20260101120000" },
    });
    await flushPromises();

    expect(fetchPlayers).toHaveBeenCalledWith("20260101120000");
    expect(wrapper.findAll("tbody tr")).toHaveLength(2);
    expect(wrapper.findAll("tbody tr")[0].text()).toContain("Alice Example");
    expect(wrapper.text()).toContain("50.12");
    expect(wrapper.text()).toContain("2.50");

    const p50Header = wrapper.findAll("thead button").find((button) => button.text().includes("P50"));
    expect(p50Header).toBeDefined();
    if (!p50Header) {
      return;
    }

    await p50Header.trigger("click");
    await flushPromises();

    expect(wrapper.findAll("tbody tr")[0].text()).toContain("Bob Example");

    await wrapper.get("select").setValue("NYK");
    await flushPromises();

    expect(wrapper.findAll("tbody tr")).toHaveLength(1);
    expect(wrapper.text()).toContain("Bob Example");

    const minAgeInput = wrapper.findAll('input[type="number"]')[0];
    await minAgeInput.setValue("40");
    await flushPromises();

    expect(wrapper.text()).toContain("No players yet.");
  });

  it("shows an error and retries loading", async () => {
    vi.mocked(fetchPlayers)
      .mockRejectedValueOnce(new Error("players unavailable"))
      .mockResolvedValueOnce([
        {
          PlayerID: 3,
          Name: "Retry Example",
          Team: "GSW",
          Age: 22,
          Baseline: 48,
          MeanDelta: 1.5,
          StdDelta: 0.9,
          P05: 38,
          P25: 45,
          P50: 55,
          P75: 60,
          P95: 66,
        },
      ]);

    const wrapper = mount(PlayerTable, {
      props: { build: "20260101120000" },
    });
    await flushPromises();

    expect(wrapper.text()).toContain("players unavailable");

    const retryButton = wrapper.findAll("button").find((button) => button.text() === "Retry");
    expect(retryButton).toBeDefined();
    if (!retryButton) {
      return;
    }

    await retryButton.trigger("click");
    await flushPromises();

    expect(fetchPlayers).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).toContain("Retry Example");
  });
});
