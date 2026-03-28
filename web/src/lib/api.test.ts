import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("ofetch", () => ({
  ofetch: vi.fn(),
}));
import { ofetch } from "ofetch";
import { fetchConfig, fetchSim, fetchSims, getApiBaseUrl } from "./api";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("getApiBaseUrl", () => {
  it("defaults to /api when unset or empty", () => {
    vi.stubEnv("VITE_API_BASE_URL", "");
    expect(getApiBaseUrl()).toBe("/api");
  });

  it("trims trailing slash from VITE_API_BASE_URL", () => {
    vi.stubEnv("VITE_API_BASE_URL", "http://127.0.0.1:8000/api/");
    expect(getApiBaseUrl()).toBe("http://127.0.0.1:8000/api");
  });
});

describe("fetch helpers", () => {
  it("calls fetchSims with the runs endpoint", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "http://127.0.0.1:8000/api/");
    vi.mocked(ofetch).mockResolvedValueOnce([]);

    await fetchSims();

    expect(vi.mocked(ofetch)).toHaveBeenCalledWith("/sims", {
      baseURL: "http://127.0.0.1:8000/api",
    });
  });

  it("encodes the build id when fetching a run", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "http://127.0.0.1:8000/api");
    vi.mocked(ofetch).mockResolvedValueOnce({
      build: "20260101120000",
      status: "complete",
      teams: [],
    });

    await fetchSim("2026/01 01");

    expect(vi.mocked(ofetch)).toHaveBeenCalledWith("/sims/2026%2F01%2001", {
      baseURL: "http://127.0.0.1:8000/api",
    });
  });

  it("calls fetchConfig with the config endpoint", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "");
    vi.mocked(ofetch).mockResolvedValueOnce({ ovr_hard_cap: 80 });

    await fetchConfig();

    expect(vi.mocked(ofetch)).toHaveBeenCalledWith("/config", {
      baseURL: "/api",
    });
  });
});
