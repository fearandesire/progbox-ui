import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchConfig } from "../lib/api";
import { useConfigStore } from "./config";

vi.mock("../lib/api", () => ({
  fetchConfig: vi.fn(),
}));

describe("useConfigStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.mocked(fetchConfig).mockReset();
  });

  it("loads config constants and clears loading state", async () => {
    vi.mocked(fetchConfig).mockResolvedValueOnce({
      ovr_hard_cap: 80,
    });

    const store = useConfigStore();
    const promise = store.load();

    expect(store.loading).toBe(true);
    await promise;

    expect(store.loading).toBe(false);
    expect(store.error).toBeNull();
    expect(store.constants).toEqual({ ovr_hard_cap: 80 });
  });

  it("captures load errors", async () => {
    vi.mocked(fetchConfig).mockRejectedValueOnce(new Error("config failed"));

    const store = useConfigStore();
    await store.load();

    expect(store.loading).toBe(false);
    expect(store.error).toBe("config failed");
    expect(store.constants).toBeNull();
  });
});
