import { ofetch } from "ofetch";
import type { GodProg, PlayerSummary, RunMetadata } from "./types";

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

export interface CreateSimInput {
  teams: string[];
  seed: number;
  runs: number;
  n_workers: number | null;
}

export interface CreateSimResponse {
  build: string;
}

export async function createSim(
  exportFile: File,
  config: CreateSimInput,
  teaminfoFile?: File | null,
): Promise<CreateSimResponse> {
  const form = new FormData();
  form.append("export", exportFile);
  form.append("config", JSON.stringify(config));
  if (teaminfoFile) {
    form.append("teaminfo", teaminfoFile);
  }
  return ofetch<CreateSimResponse>("/sims", {
    method: "POST",
    baseURL: getApiBaseUrl(),
    body: form,
  });
}

export async function fetchCharts(build: string): Promise<string[]> {
  return ofetch<string[]>(`/sims/${encodeURIComponent(build)}/analysis`, {
    baseURL: getApiBaseUrl(),
  });
}

export function chartUrl(build: string, name: string): string {
  return `${getApiBaseUrl()}/sims/${encodeURIComponent(build)}/charts/${encodeURIComponent(name)}`;
}

export async function fetchPlayers(build: string): Promise<PlayerSummary[]> {
  return ofetch<PlayerSummary[]>(`/sims/${encodeURIComponent(build)}/players`, {
    baseURL: getApiBaseUrl(),
  });
}

export async function fetchPlayer(build: string, pid: string): Promise<Record<string, unknown>[]> {
  return ofetch<Record<string, unknown>[]>(`/sims/${encodeURIComponent(build)}/players/${encodeURIComponent(pid)}`, {
    baseURL: getApiBaseUrl(),
  });
}

export async function fetchGodprogs(build: string): Promise<GodProg[]> {
  return ofetch<GodProg[]>(`/sims/${encodeURIComponent(build)}/godprogs`, {
    baseURL: getApiBaseUrl(),
  });
}

export async function deleteSim(build: string): Promise<{ ok: boolean }> {
  return ofetch<{ ok: boolean }>(`/sims/${encodeURIComponent(build)}`, {
    method: "DELETE",
    baseURL: getApiBaseUrl(),
  });
}

export function downloadUrl(build: string, artifact: "analysis" | "csv"): string {
  return `${getApiBaseUrl()}/sims/${encodeURIComponent(build)}/download?artifact=${artifact}`;
}
