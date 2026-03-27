import { afterEach, describe, expect, it, vi } from "vitest";
import { getApiBaseUrl } from "./api";

describe("getApiBaseUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults to /api when unset or empty", () => {
    vi.stubEnv("VITE_API_BASE_URL", "");
    expect(getApiBaseUrl()).toBe("/api");
  });

  it("trims trailing slash from VITE_API_BASE_URL", () => {
    vi.stubEnv("VITE_API_BASE_URL", "http://127.0.0.1:8000/api/");
    expect(getApiBaseUrl()).toBe("http://127.0.0.1:8000/api");
  });
});
