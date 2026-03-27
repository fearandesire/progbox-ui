import { ofetch } from "ofetch";
import type { RunMetadata } from "./types";

/** Base URL for API calls. Browser default `/api` (Vite proxy). Override with `VITE_API_BASE_URL`. */
export function getApiBaseUrl(): string {
  const raw = import.meta.env.VITE_API_BASE_URL;
  if (typeof raw === "string" && raw.trim().length > 0) {
    return raw.replace(/\/$/, "");
  }
  return "/api";
}

export async function fetchSims(): Promise<RunMetadata[]> {
  return ofetch<RunMetadata[]>("/sims", { baseURL: getApiBaseUrl() });
}

export async function fetchSim(build: string): Promise<RunMetadata> {
  return ofetch<RunMetadata>(`/sims/${encodeURIComponent(build)}`, {
    baseURL: getApiBaseUrl(),
  });
}

export async function fetchConfig(): Promise<Record<string, unknown>> {
  return ofetch<Record<string, unknown>>("/config", { baseURL: getApiBaseUrl() });
}
