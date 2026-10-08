import { ofetch } from "ofetch";
import type { AnalysisDataResponse, CompareDataResponse } from "./analysisTypes";
import type { GodProg, PlayerSummary, RunMetadata } from "./types";
import type {
  LabEstimate,
  LabLeague,
  LabRunCreated,
  LabRunDetail,
  LabRunInput,
  LabRunSummary,
  LabScript,
  LabScriptAdded,
  LabScriptDeleted,
  LabDiff,
  LabValidation,
} from "./labTypes";
import type { ProgressionVersion } from "./versions";

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
  version: ProgressionVersion;
  /** When true (default server-side), also run the published script and pair them. */
  compare?: boolean;
}

export interface CreateSimResponse {
  build: string;
  /** Baseline (other-version) run id when the submission created a pair. */
  compare_build?: string;
  /** Shared id linking the two runs of an auto-comparison pair. */
  pair_id?: string;
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

export function compareUrl(builds: string[]): string {
  const q = encodeURIComponent(builds.join(","));
  return `${getApiBaseUrl()}/sims/compare?builds=${q}`;
}

/** Raw engine-rendered dashboard HTML (the "Open original dashboard" escape hatch). */
export function analysisHtmlUrl(build: string): string {
  return `${getApiBaseUrl()}/sims/${encodeURIComponent(build)}/analysis`;
}

export async function fetchAnalysisData(build: string): Promise<AnalysisDataResponse> {
  return ofetch<AnalysisDataResponse>(
    `/sims/${encodeURIComponent(build)}/analysis-data`,
    { baseURL: getApiBaseUrl() },
  );
}

export async function fetchCompareData(builds: string[]): Promise<CompareDataResponse> {
  const q = encodeURIComponent(builds.join(","));
  return ofetch<CompareDataResponse>(`/sims/compare-data?builds=${q}`, {
    baseURL: getApiBaseUrl(),
  });
}

/* ---------- NET Lab ---------- */

export async function fetchLabScripts(): Promise<LabScript[]> {
  return ofetch<LabScript[]>("/lab/scripts", { baseURL: getApiBaseUrl() });
}

export async function addLabScript(input: { source: string; filename?: string; family?: string }): Promise<LabScriptAdded> {
  return ofetch<LabScriptAdded>("/lab/scripts", { method: "POST", baseURL: getApiBaseUrl(), body: input });
}

/** Delete a draft (moves it to the trash for 7 days). `runs` also trashes its runs. */
export async function deleteLabScript(id: string, runs = false): Promise<LabScriptDeleted> {
  return ofetch<LabScriptDeleted>(`/lab/scripts/${encodeURIComponent(id)}`, {
    method: "DELETE",
    baseURL: getApiBaseUrl(),
    query: runs ? { runs: "1" } : undefined,
  });
}

export async function restoreLabScript(id: string): Promise<unknown> {
  return ofetch(`/lab/scripts/${encodeURIComponent(id)}/restore`, { method: "POST", baseURL: getApiBaseUrl() });
}

/** URL of the exact stored file (served as an attachment); `original` gives a bumped script's original upload. */
export function labScriptSourceUrl(id: string, original = false): string {
  return `${getApiBaseUrl()}/lab/scripts/${encodeURIComponent(id)}/source${original ? "?original=1" : ""}`;
}

export async function fetchLabScriptSource(id: string, original = false): Promise<string> {
  return ofetch<string, "text">(`/lab/scripts/${encodeURIComponent(id)}/source`, {
    baseURL: getApiBaseUrl(),
    query: original ? { original: "1" } : undefined,
    responseType: "text",
  });
}

/** Line diff of a script against its original upload ("original") or another version id. */
export async function fetchLabScriptDiff(id: string, against: string): Promise<LabDiff> {
  return ofetch<LabDiff>(`/lab/scripts/${encodeURIComponent(id)}/diff`, { baseURL: getApiBaseUrl(), query: { against } });
}

export async function fetchLabLeagues(): Promise<LabLeague[]> {
  return ofetch<LabLeague[]>("/lab/leagues", { baseURL: getApiBaseUrl() });
}

export async function downloadLabLeagues(): Promise<LabLeague[]> {
  return ofetch<LabLeague[]>("/lab/leagues/fetch", { method: "POST", baseURL: getApiBaseUrl() });
}

export async function uploadLabLeague(file: File, name?: string): Promise<{ league: LabLeague; validation: LabValidation }> {
  const form = new FormData();
  if (name) form.append("name", name);
  form.append("file", file);
  return ofetch("/lab/leagues", { method: "POST", baseURL: getApiBaseUrl(), body: form });
}

export async function checkLabLeague(id: string): Promise<LabValidation> {
  return ofetch<LabValidation>(`/lab/leagues/${encodeURIComponent(id)}/check`, { baseURL: getApiBaseUrl() });
}

export async function fetchLabEstimate(input: LabRunInput): Promise<LabEstimate> {
  const query: Record<string, string> = { script: input.script, mode: input.mode };
  if (input.baseline) query.baseline = input.baseline;
  if (input.league) query.league = input.league;
  if (input.unlock) {
    query.unlock = "1";
    for (const k of ["runs", "seasons", "replicates"] as const) {
      const v = input.unlock[k];
      if (v !== undefined) query[k] = String(v);
    }
  }
  return ofetch<LabEstimate>("/lab/estimate", { baseURL: getApiBaseUrl(), query });
}

export async function createLabRun(input: LabRunInput): Promise<LabRunCreated> {
  return ofetch<LabRunCreated>("/lab/runs", { method: "POST", baseURL: getApiBaseUrl(), body: input });
}

export async function fetchLabRuns(): Promise<LabRunSummary[]> {
  return ofetch<LabRunSummary[]>("/lab/runs", { baseURL: getApiBaseUrl() });
}

export async function fetchLabRun(id: string): Promise<LabRunDetail> {
  return ofetch<LabRunDetail>(`/lab/runs/${encodeURIComponent(id)}`, { baseURL: getApiBaseUrl() });
}

export function labFileUrl(runId: string, name: string): string {
  return `${getApiBaseUrl()}/lab/runs/${encodeURIComponent(runId)}/files/${encodeURIComponent(name)}`;
}

/** Pull the API's `detail` message out of an ofetch error. */
export function labErrorMessage(err: unknown, fallback = "Request failed"): string {
  if (err && typeof err === "object" && "data" in err) {
    const data = (err as { data?: unknown }).data;
    if (data && typeof data === "object" && "detail" in data) {
      const d = (data as { detail?: unknown }).detail;
      if (typeof d === "string" && d) return d;
    }
  }
  if (err instanceof Error) return err.message;
  return fallback;
}
