import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchSims } from "../lib/api";
import { useSimsStore } from "./sims";

vi.mock("../lib/api", () => ({
  fetchSims: vi.fn(),
}));

describe("useSimsStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.mocked(fetchSims).mockReset();
  });

  it("loads runs and clears loading state", async () => {
    vi.mocked(fetchSims).mockResolvedValueOnce([
      { build: "20260101120000", status: "complete", teams: [] },
    ]);

    const store = useSimsStore();
    const promise = store.load();

    expect(store.loading).toBe(true);
    await promise;

    expect(store.loading).toBe(false);
    expect(store.error).toBeNull();
    expect(store.runs).toEqual([
      { build: "20260101120000", status: "complete", teams: [] },
    ]);
  });

  it("captures load errors", async () => {
    vi.mocked(fetchSims).mockRejectedValueOnce(new Error("network down"));

    const store = useSimsStore();
    await store.load();

    expect(store.loading).toBe(false);
    expect(store.error).toBe("network down");
    expect(store.runs).toEqual([]);
  });
});
