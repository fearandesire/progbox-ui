import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "./api";

type Call = { url: string; method: string; body: unknown };

const fetchMock = vi.fn();

function respond(status: number, body: unknown, type = "application/json") {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  fetchMock.mockResolvedValueOnce(new Response(text, { status, headers: { "content-type": type } }));
}

function lastCall(): Call {
  const [input, init] = fetchMock.mock.calls.at(-1)! as [string | Request, RequestInit | undefined];
  const req = input instanceof Request ? input : null;
  return { url: req ? req.url : String(input), method: (req?.method ?? init?.method ?? "GET").toUpperCase(), body: init?.body };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("VITE_API_BASE_URL", "http://lab.test/api/");
});

describe("NET Lab API", () => {
  it("returns parsed JSON from a successful run fetch and encodes the id", async () => {
    respond(200, { runId: "r 1", state: "done" });
    await expect(api.fetchLabRun("r 1")).resolves.toEqual({ runId: "r 1", state: "done" });
    expect(lastCall().url).toBe("http://lab.test/api/lab/runs/r%201");
  });

  it("throws the API detail on an HTTP error, which labErrorMessage pulls out", async () => {
    respond(404, { detail: "No such run" });
    const err = await api.fetchLabRun("missing").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(api.labErrorMessage(err)).toBe("No such run");
  });

  it("falls back to the error message when the body has no detail", async () => {
    // ofetch retries a failed GET once before giving up.
    respond(500, "boom", "text/plain");
    respond(500, "boom", "text/plain");
    const err = await api.fetchLabRuns().catch((e: unknown) => e);
    expect(api.labErrorMessage(err)).toMatch(/500/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("posts a new run and lists scripts, leagues and runs", async () => {
    respond(200, { runId: null, queueId: "q1", state: "queued" });
    await expect(api.createLabRun({ mode: "quick", script: "net@4.3.0" })).resolves.toMatchObject({ queueId: "q1" });
    expect(lastCall().method).toBe("POST");
    expect(lastCall().url).toBe("http://lab.test/api/lab/runs");

    respond(200, [{ id: "net@4.3.0" }]);
    await expect(api.fetchLabScripts()).resolves.toEqual([{ id: "net@4.3.0" }]);
    respond(200, [{ id: "nba" }]);
    await expect(api.fetchLabLeagues()).resolves.toEqual([{ id: "nba" }]);
    respond(200, [{ id: "nba" }]);
    await api.downloadLabLeagues();
    expect(lastCall()).toMatchObject({ method: "POST", url: "http://lab.test/api/lab/leagues/fetch" });
  });

  it("sends estimate options as a query, including unlocked sizes", async () => {
    respond(200, { seconds: 30, basis: [] });
    await api.fetchLabEstimate({ mode: "deep", script: "a@1", baseline: "b@1", league: "nba", unlock: { runs: 10, replicates: 4 } });
    const url = new URL(lastCall().url);
    expect(Object.fromEntries(url.searchParams)).toEqual({ script: "a@1", mode: "deep", baseline: "b@1", league: "nba", unlock: "1", runs: "10", replicates: "4" });

    respond(200, { seconds: 1, basis: [] });
    await api.fetchLabEstimate({ mode: "quick", script: "a@1" });
    expect(Object.fromEntries(new URL(lastCall().url).searchParams)).toEqual({ script: "a@1", mode: "quick" });
  });

  it("manages scripts: add, delete with runs, restore, source and diff", async () => {
    respond(200, { entry: { id: "net@5.0.0" }, created: true, notes: [] });
    await api.addLabScript({ source: "x", filename: "net.js" });
    expect(lastCall()).toMatchObject({ method: "POST", url: "http://lab.test/api/lab/scripts" });

    respond(200, { id: "a@1", trashedUntil: "2026-10-15" });
    await api.deleteLabScript("a@1", true);
    expect(lastCall()).toMatchObject({ method: "DELETE", url: "http://lab.test/api/lab/scripts/a%401?runs=1" });
    respond(200, { id: "a@1", trashedUntil: "2026-10-15" });
    await api.deleteLabScript("a@1");
    expect(lastCall().url).toBe("http://lab.test/api/lab/scripts/a%401");

    respond(200, {});
    await api.restoreLabScript("a@1");
    expect(lastCall()).toMatchObject({ method: "POST", url: "http://lab.test/api/lab/scripts/a%401/restore" });

    respond(200, "export default 1;", "text/plain");
    await expect(api.fetchLabScriptSource("a@1", true)).resolves.toBe("export default 1;");
    expect(lastCall().url).toBe("http://lab.test/api/lab/scripts/a%401/source?original=1");
    respond(200, "x", "text/plain");
    await api.fetchLabScriptSource("a@1");
    expect(lastCall().url).toBe("http://lab.test/api/lab/scripts/a%401/source");

    respond(200, { against: "original", rows: [] });
    await api.fetchLabScriptDiff("a@1", "original");
    expect(lastCall().url).toBe("http://lab.test/api/lab/scripts/a%401/diff?against=original");
  });

  it("uploads and checks a league", async () => {
    respond(200, { league: { id: "mine" }, validation: { ok: true } });
    await api.uploadLabLeague(new File(["{}"], "league.json"), "Mine");
    const body = lastCall().body as FormData;
    expect(body.get("name")).toBe("Mine");
    expect(body.get("file")).toBeInstanceOf(File);

    respond(200, { league: { id: "x" }, validation: { ok: true } });
    await api.uploadLabLeague(new File(["{}"], "league.json"));
    expect((lastCall().body as FormData).has("name")).toBe(false);

    respond(200, { ok: true, issues: [] });
    await api.checkLabLeague("my league");
    expect(lastCall().url).toBe("http://lab.test/api/lab/leagues/my%20league/check");
  });

  it("builds file and source URLs from the base", () => {
    expect(api.labFileUrl("r1", "report.json")).toBe("http://lab.test/api/lab/runs/r1/files/report.json");
    expect(api.labScriptSourceUrl("a@1")).toBe("http://lab.test/api/lab/scripts/a%401/source");
    expect(api.labScriptSourceUrl("a@1", true)).toBe("http://lab.test/api/lab/scripts/a%401/source?original=1");
  });
});

describe("sims API", () => {
  it("creates a sim with an optional teaminfo file", async () => {
    const config = { teams: ["BOS"], seed: 1, runs: 10, n_workers: null, version: "v1" } as unknown as api.CreateSimInput;
    respond(200, { build: "b1" });
    await expect(api.createSim(new File(["x"], "export.json"), config, new File(["t"], "teaminfo.csv"))).resolves.toEqual({ build: "b1" });
    const body = lastCall().body as FormData;
    expect(JSON.parse(String(body.get("config")))).toMatchObject({ teams: ["BOS"] });
    expect(body.has("teaminfo")).toBe(true);

    respond(200, { build: "b2" });
    await api.createSim(new File(["x"], "export.json"), config);
    expect((lastCall().body as FormData).has("teaminfo")).toBe(false);
  });

  it("fetches per-build resources at encoded paths", async () => {
    const cases: [() => Promise<unknown>, string, string?][] = [
      [() => api.fetchPlayers("b/1"), "/sims/b%2F1/players"],
      [() => api.fetchPlayer("b1", "p 2"), "/sims/b1/players/p%202"],
      [() => api.fetchGodprogs("b1"), "/sims/b1/godprogs"],
      [() => api.deleteSim("b1"), "/sims/b1", "DELETE"],
      [() => api.fetchAnalysisData("b1"), "/sims/b1/analysis-data"],
      [() => api.fetchCompareData(["a", "b"]), "/sims/compare-data?builds=a%2Cb"],
    ];
    for (const [call, path, method = "GET"] of cases) {
      respond(200, {});
      await call();
      expect(lastCall()).toMatchObject({ url: `http://lab.test/api${path}`, method });
    }
  });

  it("builds chart, download, compare and analysis URLs", () => {
    expect(api.chartUrl("b1", "ovr hist.png")).toBe("http://lab.test/api/sims/b1/charts/ovr%20hist.png");
    expect(api.downloadUrl("b1", "csv")).toBe("http://lab.test/api/sims/b1/download?artifact=csv");
    expect(api.compareUrl(["a", "b"])).toBe("http://lab.test/api/sims/compare?builds=a%2Cb");
    expect(api.analysisHtmlUrl("b1")).toBe("http://lab.test/api/sims/b1/analysis");
  });
});

describe("labErrorMessage", () => {
  it("prefers a non-empty string detail, then the error message, then the fallback", () => {
    expect(api.labErrorMessage({ data: { detail: "Script not found" } })).toBe("Script not found");
    expect(api.labErrorMessage(Object.assign(new Error("HTTP 500"), { data: { detail: "" } }))).toBe("HTTP 500");
    expect(api.labErrorMessage(Object.assign(new Error("HTTP 422"), { data: { detail: [{ msg: "bad" }] } }))).toBe("HTTP 422");
    expect(api.labErrorMessage(Object.assign(new Error("offline"), { data: null }))).toBe("offline");
    expect(api.labErrorMessage("nope")).toBe("Request failed");
    expect(api.labErrorMessage(undefined, "Could not load")).toBe("Could not load");
  });
});
