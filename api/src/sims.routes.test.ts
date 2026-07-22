import FormData from "form-data";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import { isValidBuildId } from "./buildId.js";
import { PROGRESS } from "./services/progress.js";
import * as runner from "./services/runner.js";
import * as analysisPython from "./services/analysisPython.js";
import { useIsolatedOutputs, makeRunDir, isolatedOutputsPath } from "./testUtils.js";

useIsolatedOutputs();

const testApps: FastifyInstance[] = [];

async function buildTestApp() {
  const app = await buildApp({
    scheduleBackground: (task) => {
      void task();
    },
  });
  testApps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(testApps.map((a) => a.close()));
  testApps.length = 0;
  vi.restoreAllMocks();
});

async function multipartPost(
  app: Awaited<ReturnType<typeof buildApp>>,
  exportPayload: object,
  config: object,
  teaminfo?: object,
) {
  const form = new FormData();
  form.append("export", Buffer.from(JSON.stringify(exportPayload)), {
    filename: "export.json",
    contentType: "application/json",
  });
  form.append("config", JSON.stringify(config));
  if (teaminfo !== undefined) {
    form.append("teaminfo", Buffer.from(JSON.stringify(teaminfo)), {
      filename: "teaminfo.json",
      contentType: "application/json",
    });
  }
  return app.inject({
    method: "POST",
    url: "/api/sims",
    payload: form.getBuffer() as Buffer,
    headers: form.getHeaders() as Record<string, string>,
  });
}

describe("sims routes", () => {
  it("list empty", async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: "GET", url: "/api/sims" });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual([]);
  });

  it("list sorted skips incomplete", async () => {
    makeRunDir("20260101120000");
    makeRunDir("20260201120000", { metadata: { status: "running" } });
    const incomplete = makeRunDir("20260301120000");
    fs.unlinkSync(path.join(incomplete, "metadata.json"));
    makeRunDir("not-a-build");

    const app = await buildTestApp();
    const res = await app.inject({ method: "GET", url: "/api/sims" });
    const builds = (JSON.parse(res.body) as { build: string }[]).map((r) => r.build);
    expect(builds).toEqual(["20260201120000", "20260101120000"]);
  });

  it("get invalid build 422", async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: "GET", url: "/api/sims/not-a-build" });
    expect(res.statusCode).toBe(422);
  });

  it("get not found", async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: "GET", url: "/api/sims/20260101120000" });
    expect(res.statusCode).toBe(404);
  });

  it("get sim ok", async () => {
    makeRunDir("20260101120000", { metadata: { status: "complete", teams: ["BOS"] } });
    const app = await buildTestApp();
    const res = await app.inject({ method: "GET", url: "/api/sims/20260101120000" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect(body.build).toBe("20260101120000");
    expect(body.status).toBe("complete");
    expect(body.teams).toEqual(["BOS"]);
  });

  it("progress uses live PROGRESS", async () => {
    const build = "20260101120000";
    makeRunDir(build, { metadata: { status: "running" } });
    PROGRESS.set(build, {
      phase: "simulating",
      pct: 42.5,
      message: "Simulating",
      done: true,
    });
    const app = await buildTestApp();
    const res = await app.inject({ method: "GET", url: `/api/sims/${build}/progress` });
    expect(res.statusCode).toBe(200);
    const firstLine = res.body.split("\n").find((l) => l.startsWith("data: "));
    expect(firstLine).toBeDefined();
    const payload = JSON.parse(firstLine!.slice(6)) as Record<string, unknown>;
    expect(payload).toMatchObject({
      phase: "simulating",
      pct: 42.5,
      message: "Simulating",
      done: true,
    });
  });

  it("progress complete from metadata", async () => {
    const build = "20260101120000";
    makeRunDir(build, { metadata: { status: "complete" } });
    const app = await buildTestApp();
    const res = await app.inject({ method: "GET", url: `/api/sims/${build}/progress` });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('"phase":"complete"');
    expect(res.body).toContain('"done":true');
  });

  it("progress failed from metadata", async () => {
    const build = "20260101120000";
    makeRunDir(build, { metadata: { status: "failed", error: "boom" } });
    const app = await buildTestApp();
    const res = await app.inject({ method: "GET", url: `/api/sims/${build}/progress` });
    expect(res.body).toContain('"phase":"failed"');
    expect(res.body).toContain('"message":"boom"');
  });

  it("progress 404", async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: "GET", url: "/api/sims/20260101120000/progress" });
    expect(res.statusCode).toBe(404);
  });

  it("charts list and lookup", async () => {
    const build = "20260101120000";
    makeRunDir(build, { charts: ["02_beta.png", "01_alpha.png", "notes.txt"] });
    const app = await buildTestApp();
    const list = await app.inject({ method: "GET", url: `/api/sims/${build}/charts` });
    expect(list.statusCode).toBe(200);
    expect(JSON.parse(list.body)).toEqual(["01_alpha.png", "02_beta.png"]);
    const chart = await app.inject({
      method: "GET",
      url: `/api/sims/${build}/charts/01_alpha.png`,
    });
    expect(chart.statusCode).toBe(200);
    expect(chart.headers["content-type"]).toContain("image/png");
    expect(chart.body).toBe("png");
  });

  it("chart rejects traversal", async () => {
    const build = "20260101120000";
    makeRunDir(build, { charts: ["01_alpha.png"] });
    const app = await buildTestApp();
    const name = encodeURIComponent("subdir/chart.png");
    const res = await app.inject({
      method: "GET",
      url: `/api/sims/${build}/charts/${name}`,
    });
    expect(res.statusCode).toBe(400);
  });

  it("charts list not found when run missing", async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/sims/20260101120000/charts",
    });
    expect(res.statusCode).toBe(404);
  });

  it("players routes", async () => {
    const build = "20260101120000";
    makeRunDir(build, {
      rawRows: [
        {
          PlayerID: 0,
          Name: "Alpha One",
          Team: "BOS",
          Age: 29,
          Baseline: 55,
          Ovr: 56,
          Delta: 1.0,
        },
        {
          PlayerID: 0,
          Name: "Alpha One",
          Team: "BOS",
          Age: 29,
          Baseline: 55,
          Ovr: 57,
          Delta: 2.0,
        },
        {
          PlayerID: 1,
          Name: "Beta Two",
          Team: "NYK",
          Age: 31,
          Baseline: 53,
          Ovr: 52,
          Delta: -1.0,
        },
        {
          PlayerID: 1,
          Name: "Beta Two",
          Team: "NYK",
          Age: 31,
          Baseline: 53,
          Ovr: 54,
          Delta: 1.0,
        },
      ],
    });
    const app = await buildTestApp();
    const summary = await app.inject({ method: "GET", url: `/api/sims/${build}/players` });
    expect(summary.statusCode).toBe(200);
    const rows = JSON.parse(summary.body) as { PlayerID: number; MeanDelta: number }[];
    expect(rows.map((r) => r.PlayerID)).toEqual([0, 1]);
    expect(rows[0]!.MeanDelta).toBeCloseTo(1.5, 5);
    const detail = await app.inject({ method: "GET", url: `/api/sims/${build}/players/0` });
    expect(detail.statusCode).toBe(200);
    expect(JSON.parse(detail.body).length).toBe(2);
  });

  it("player detail 404", async () => {
    const build = "20260101120000";
    makeRunDir(build, {
      rawRows: [
        {
          PlayerID: 0,
          Name: "Alpha One",
          Team: "BOS",
          Age: 29,
          Baseline: 55,
          Ovr: 56,
          Delta: 1.0,
        },
      ],
    });
    const app = await buildTestApp();
    const res = await app.inject({ method: "GET", url: `/api/sims/${build}/players/999` });
    expect(res.statusCode).toBe(404);
  });

  it("godprogs", async () => {
    const build = "20260101120000";
    makeRunDir(build, { godprogs: [{ name: "Alpha One", run_seed: 1 }] });
    const app = await buildTestApp();
    const res = await app.inject({ method: "GET", url: `/api/sims/${build}/godprogs` });
    expect(JSON.parse(res.body)).toEqual([{ name: "Alpha One", run_seed: 1 }]);
  });

  it("download", async () => {
    const build = "20260101120000";
    makeRunDir(build, {
      extraFiles: {
        "analysis.xlsx": "xlsx-bytes",
        "raw/outputs.csv": "PlayerID,Name\n0,Alpha One\n",
      },
    });
    const app = await buildTestApp();
    const xlsx = await app.inject({
      method: "GET",
      url: `/api/sims/${build}/download?artifact=analysis`,
    });
    expect(xlsx.statusCode).toBe(200);
    expect(xlsx.headers["content-disposition"]).toContain("analysis.xlsx");
    expect(xlsx.body).toBe("xlsx-bytes");
    const csv = await app.inject({
      method: "GET",
      url: `/api/sims/${build}/download?artifact=csv`,
    });
    expect(csv.headers["content-type"]).toMatch(/^text\/csv/);
    expect(csv.body.replace(/\r\n/g, "\n")).toBe("PlayerID,Name\n0,Alpha One\n");
    const bad = await app.inject({
      method: "GET",
      url: `/api/sims/${build}/download?artifact=zip`,
    });
    expect(bad.statusCode).toBe(422);
  });

  it("delete", async () => {
    const build = "20260101120000";
    const dir = makeRunDir(build);
    const app = await buildTestApp();
    const res = await app.inject({ method: "DELETE", url: `/api/sims/${build}` });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
    expect(fs.existsSync(dir)).toBe(false);
  });

  it("delete clears pair metadata on the surviving sibling", async () => {
    const primary = "20260101120000";
    const baseline = "20260101120001";
    makeRunDir(primary, {
      metadata: {
        pair_id: primary,
        pair_role: "primary",
        paired_with: baseline,
      },
    });
    makeRunDir(baseline, {
      metadata: {
        pair_id: primary,
        pair_role: "baseline",
        paired_with: primary,
      },
    });
    const app = await buildTestApp();
    const res = await app.inject({ method: "DELETE", url: `/api/sims/${primary}` });
    expect(res.statusCode).toBe(200);

    const sibling = await app.inject({ method: "GET", url: `/api/sims/${baseline}` });
    expect(sibling.statusCode).toBe(200);
    const meta = JSON.parse(sibling.body) as {
      pair_id?: string;
      pair_role?: string;
      paired_with?: string;
      status: string;
    };
    expect(meta.pair_id).toBeUndefined();
    expect(meta.pair_role).toBeUndefined();
    expect(meta.paired_with).toBeUndefined();
    expect(meta.status).toBe("complete");
  });

  it("nested progress not captured as build", async () => {
    const build = "20260101120000";
    makeRunDir(build, { metadata: { status: "complete", teams: [] } });
    const app = await buildTestApp();
    const res = await app.inject({ method: "GET", url: `/api/sims/${build}/progress` });
    expect(res.headers["content-type"]).toMatch(/^text\/event-stream/);
  });

  it("post sim schedules job", async () => {
    const spy = vi.spyOn(runner, "runSimulationJob").mockResolvedValue(undefined);
    const app = await buildTestApp();
    const res = await multipartPost(
      app,
      { players: [{ stats: [], tid: 0 }] },
      { teams: [], seed: 1, runs: 10, n_workers: 1, compare: false },
      { "0": "BOS" },
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { build: string };
    expect(body.build).toHaveLength(14);
    expect(spy).toHaveBeenCalledTimes(1);
    const args = spy.mock.calls[0]!;
    expect(args[0]).toBe(body.build);
    expect(path.basename(args[1] as string)).toBe("export.json");
    expect(path.basename(args[2] as string)).toBe("teaminfo.json");
    expect(args[3]).toEqual([]);
    expect(args[4]).toBe(1);
    expect(args[5]).toBe(10);
    expect(args[6]).toBeGreaterThanOrEqual(1);
    spy.mockRestore();
  });

  it("post sim defaults progression version to v43", async () => {
    const spy = vi.spyOn(runner, "runSimulationJob").mockResolvedValue(undefined);
    const app = await buildTestApp();
    const res = await multipartPost(
      app,
      { players: [{ stats: [], tid: 0 }] },
      { teams: [], seed: 1, runs: 10, n_workers: 1 },
      { "0": "BOS" },
    );
    expect(res.statusCode).toBe(200);
    const build = (JSON.parse(res.body) as { build: string }).build;
    expect(spy.mock.calls[0]![7]).toBe("v43");
    const meta = JSON.parse(
      fs.readFileSync(path.join(isolatedOutputsPath(), build, "metadata.json"), "utf8"),
    );
    expect(meta.requested_version).toBe("v43");
    expect(meta.script_version).toBe("v4.3");
    spy.mockRestore();
  });

  it("post sim accepts an explicit v41 version", async () => {
    const spy = vi.spyOn(runner, "runSimulationJob").mockResolvedValue(undefined);
    const app = await buildTestApp();
    const res = await multipartPost(
      app,
      { players: [{ stats: [], tid: 0 }] },
      { teams: [], seed: 1, runs: 10, n_workers: 1, version: "v41" },
      { "0": "BOS" },
    );
    expect(res.statusCode).toBe(200);
    const build = (JSON.parse(res.body) as { build: string }).build;
    expect(spy.mock.calls[0]![7]).toBe("v41");
    const meta = JSON.parse(
      fs.readFileSync(path.join(isolatedOutputsPath(), build, "metadata.json"), "utf8"),
    );
    expect(meta.requested_version).toBe("v41");
    spy.mockRestore();
  });

  it("post sim rejects an invalid version", async () => {
    const spy = vi.spyOn(runner, "runSimulationJob").mockResolvedValue(undefined);
    const app = await buildTestApp();
    const res = await multipartPost(
      app,
      { players: [{ stats: [], tid: 0 }] },
      { teams: [], seed: 1, runs: 10, n_workers: 1, version: "v99" },
      { "0": "BOS" },
    );
    expect(res.statusCode).toBe(422);
    expect(spy).not.toHaveBeenCalled();
    expect(fs.readdirSync(isolatedOutputsPath())).toEqual([]);
    spy.mockRestore();
  });

  it("post sim cleans up reserved dirs when config validation fails", async () => {
    const spy = vi.spyOn(runner, "runSimulationJob").mockResolvedValue(undefined);
    const app = await buildTestApp();
    const form = new FormData();
    form.append("export", Buffer.from(JSON.stringify({ players: [{ stats: [], tid: 0 }] })), {
      filename: "export.json",
      contentType: "application/json",
    });
    form.append("config", "{not-json");
    const res = await app.inject({
      method: "POST",
      url: "/api/sims",
      payload: form.getBuffer() as Buffer,
      headers: form.getHeaders() as Record<string, string>,
    });
    expect(res.statusCode).toBe(422);
    expect(spy).not.toHaveBeenCalled();
    expect(fs.readdirSync(isolatedOutputsPath())).toEqual([]);
    spy.mockRestore();
  });

  it("post sim cleans up both pair dirs when baseline metadata write fails", async () => {
    const spy = vi.spyOn(runner, "runSimulationJob").mockResolvedValue(undefined);
    let metadataWrites = 0;
    const originalWriteFile = fs.promises.writeFile.bind(fs.promises);
    const writeSpy = vi.spyOn(fs.promises, "writeFile").mockImplementation(
      async (filePath, data, options) => {
        if (String(filePath).replace(/\\/g, "/").endsWith("/metadata.json")) {
          metadataWrites += 1;
          if (metadataWrites >= 2) {
            throw new Error("ENOSPC");
          }
        }
        return originalWriteFile(filePath, data as never, options as never);
      },
    );

    const app = await buildTestApp();
    const res = await multipartPost(
      app,
      { players: [{ stats: [], tid: 0 }] },
      { teams: [], seed: 1, runs: 10, n_workers: 1, version: "v43" },
      { "0": "BOS" },
    );
    expect(res.statusCode).toBe(500);
    expect(spy).not.toHaveBeenCalled();
    expect(fs.readdirSync(isolatedOutputsPath())).toEqual([]);

    writeSpy.mockRestore();
    spy.mockRestore();
  });

  it("post sim defaults compare to true and schedules a paired run", async () => {
    const spy = vi.spyOn(runner, "runSimulationJob").mockResolvedValue(undefined);
    const app = await buildTestApp();
    const res = await multipartPost(
      app,
      { players: [{ stats: [], tid: 0 }] },
      { teams: ["BOS"], seed: 7, runs: 12, n_workers: 3, version: "v43" },
      { "0": "BOS" },
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      build: string;
      compare_build: string;
      pair_id: string;
    };
    expect(body.build).toHaveLength(14);
    expect(body.compare_build).toHaveLength(14);
    expect(body.pair_id).toBe(body.build);

    // Two jobs, one per version, same inputs, distinct valid build dirs.
    expect(spy).toHaveBeenCalledTimes(2);
    const [primary, baseline] = spy.mock.calls;
    expect(primary![7]).toBe("v43");
    expect(baseline![7]).toBe("v41");
    // Same seed / teams / n_workers across both runs.
    expect(primary![3]).toEqual(baseline![3]);
    expect(primary![3]).toEqual(["BOS"]);
    expect(primary![4]).toBe(baseline![4]);
    expect(primary![4]).toBe(7);
    expect(primary![5]).toBe(baseline![5]);
    expect(primary![5]).toBe(12);
    expect(primary![6]).toBe(baseline![6]);
    expect(primary![6]).toBe(3);
    // Each run points at its own build dir; basenames match, dirnames differ.
    const primaryDir = path.dirname(primary![1] as string);
    const baselineDir = path.dirname(baseline![1] as string);
    expect(path.basename(primary![1] as string)).toBe("export.json");
    expect(path.basename(baseline![1] as string)).toBe("export.json");
    expect(primaryDir).not.toBe(baselineDir);
    expect(path.dirname(primary![2] as string)).toBe(primaryDir);
    expect(path.dirname(baseline![2] as string)).toBe(baselineDir);
    expect(isValidBuildId(path.basename(primaryDir))).toBe(true);
    expect(isValidBuildId(path.basename(baselineDir))).toBe(true);
    expect(primary![0]).toBe(body.build);
    expect(baseline![0]).toBe(body.compare_build);
    spy.mockRestore();
  });

  it("post sim records consistent pair metadata for both runs", async () => {
    const spy = vi.spyOn(runner, "runSimulationJob").mockResolvedValue(undefined);
    const app = await buildTestApp();
    const res = await multipartPost(
      app,
      { players: [{ stats: [], tid: 0 }] },
      { teams: [], seed: 1, runs: 10, n_workers: 1, version: "v43" },
      { "0": "BOS" },
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      build: string;
      compare_build: string;
      pair_id: string;
    };

    const primaryMeta = JSON.parse(
      fs.readFileSync(path.join(isolatedOutputsPath(), body.build, "metadata.json"), "utf8"),
    );
    const baselineMeta = JSON.parse(
      fs.readFileSync(
        path.join(isolatedOutputsPath(), body.compare_build, "metadata.json"),
        "utf8",
      ),
    );

    expect(primaryMeta.pair_id).toBe(body.pair_id);
    expect(baselineMeta.pair_id).toBe(body.pair_id);
    expect(primaryMeta.pair_role).toBe("primary");
    expect(baselineMeta.pair_role).toBe("baseline");
    expect(primaryMeta.paired_with).toBe(body.compare_build);
    expect(baselineMeta.paired_with).toBe(body.build);
    // Each run reflects its own version.
    expect(primaryMeta.requested_version).toBe("v43");
    expect(primaryMeta.script_version).toBe("v4.3");
    expect(baselineMeta.requested_version).toBe("v41");
    expect(baselineMeta.script_version).toBe("v4.1");
    // Each paired run is self-contained with its own export + teaminfo copy.
    expect(
      fs.existsSync(path.join(isolatedOutputsPath(), body.compare_build, "export.json")),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(isolatedOutputsPath(), body.compare_build, "teaminfo.json")),
    ).toBe(true);
    spy.mockRestore();
  });

  it("post sim compare false returns a single build with no pair fields", async () => {
    const spy = vi.spyOn(runner, "runSimulationJob").mockResolvedValue(undefined);
    const app = await buildTestApp();
    const res = await multipartPost(
      app,
      { players: [{ stats: [], tid: 0 }] },
      { teams: [], seed: 1, runs: 10, n_workers: 1, compare: false },
      { "0": "BOS" },
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect(typeof body.build).toBe("string");
    expect(body.compare_build).toBeUndefined();
    expect(body.pair_id).toBeUndefined();
    expect(spy).toHaveBeenCalledTimes(1);
    const meta = JSON.parse(
      fs.readFileSync(
        path.join(isolatedOutputsPath(), body.build as string, "metadata.json"),
        "utf8",
      ),
    );
    expect(meta.pair_id).toBeUndefined();
    expect(meta.pair_role).toBeUndefined();
    expect(meta.paired_with).toBeUndefined();
    spy.mockRestore();
  });

  it("post sim bumps past an occupied CalVer build directory", async () => {
    const spy = vi.spyOn(runner, "runSimulationJob").mockResolvedValue(undefined);
    const pad = (n: number, w = 2) => String(n).padStart(w, "0");
    const d = new Date();
    const taken =
      `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
      `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
    // Occupy the current second and the next so allocation must advance further.
    const takenNext = (() => {
      const n = new Date(d.getTime());
      n.setUTCSeconds(n.getUTCSeconds() + 1);
      return (
        `${n.getUTCFullYear()}${pad(n.getUTCMonth() + 1)}${pad(n.getUTCDate())}` +
        `${pad(n.getUTCHours())}${pad(n.getUTCMinutes())}${pad(n.getUTCSeconds())}`
      );
    })();
    fs.mkdirSync(path.join(isolatedOutputsPath(), taken));
    fs.mkdirSync(path.join(isolatedOutputsPath(), takenNext));

    const app = await buildTestApp();
    const res = await multipartPost(
      app,
      { players: [{ stats: [], tid: 0 }] },
      { teams: [], seed: 1, runs: 10, n_workers: 1, compare: false },
      { "0": "BOS" },
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { build: string };
    expect(body.build).not.toBe(taken);
    expect(body.build).not.toBe(takenNext);
    expect(
      fs.existsSync(path.join(isolatedOutputsPath(), body.build, "metadata.json")),
    ).toBe(true);
    spy.mockRestore();
  });

  it("post validation", async () => {
    const spy = vi.spyOn(runner, "runSimulationJob").mockResolvedValue(undefined);
    const app = await buildTestApp();
    const emptyForm = new FormData();
    emptyForm.append("export", Buffer.alloc(0), {
      filename: "export.json",
      contentType: "application/json",
    });
    emptyForm.append("config", JSON.stringify({ teams: [], seed: 1, runs: 10, n_workers: 1 }));
    const empty = await app.inject({
      method: "POST",
      url: "/api/sims",
      payload: emptyForm.getBuffer() as Buffer,
      headers: emptyForm.getHeaders() as Record<string, string>,
    });
    expect(empty.statusCode).toBe(422);

    const emptyTeaminfo = new FormData();
    emptyTeaminfo.append(
      "export",
      Buffer.from(JSON.stringify({ players: [] })),
      { filename: "export.json", contentType: "application/json" },
    );
    emptyTeaminfo.append(
      "teaminfo",
      Buffer.alloc(0),
      { filename: "teaminfo.json", contentType: "application/json" },
    );
    emptyTeaminfo.append("config", JSON.stringify({ teams: [], seed: 1, runs: 10, n_workers: 1 }));
    const ti = await app.inject({
      method: "POST",
      url: "/api/sims",
      payload: emptyTeaminfo.getBuffer() as Buffer,
      headers: emptyTeaminfo.getHeaders() as Record<string, string>,
    });
    expect(ti.statusCode).toBe(422);

    const badWorkers = await multipartPost(
      app,
      { players: [] },
      { teams: [], seed: 1, runs: 10, n_workers: 0 },
    );
    expect(badWorkers.statusCode).toBe(422);
    spy.mockRestore();
  });

  it("analysis html when present", async () => {
    const build = "20260101120000";
    makeRunDir(build, {
      extraFiles: { "analysis_dashboard.html": "<html>ok</html>" },
    });
    const app = await buildTestApp();
    const res = await app.inject({ method: "GET", url: `/api/sims/${build}/analysis` });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/html/);
    expect(res.body).toBe("<html>ok</html>");
  });

  it("analysis html 404 when missing", async () => {
    const build = "20260101120000";
    makeRunDir(build);
    const app = await buildTestApp();
    const res = await app.inject({ method: "GET", url: `/api/sims/${build}/analysis` });
    expect(res.statusCode).toBe(404);
  });

  it("compare rejects fewer than two builds", async () => {
    makeRunDir("20260101120000");
    const app = await buildTestApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/sims/compare?builds=20260101120000",
    });
    expect(res.statusCode).toBe(400);
  });

  it("compare rejects duplicate build ids", async () => {
    const build = "20260101120000";
    makeRunDir(build);
    const spy = vi.spyOn(analysisPython, "runPythonComparison");
    const app = await buildTestApp();
    const res = await app.inject({
      method: "GET",
      url: `/api/sims/compare?builds=${build},${build}`,
    });
    expect(res.statusCode).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });

  it("compare rejects an invalid build id", async () => {
    makeRunDir("20260101120000");
    const app = await buildTestApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/sims/compare?builds=20260101120000,not-a-build",
    });
    expect(res.statusCode).toBe(422);
  });

  it("compare 404s an unknown build", async () => {
    makeRunDir("20260101120000");
    const app = await buildTestApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/sims/compare?builds=20260101120000,20990101120000",
    });
    expect(res.statusCode).toBe(404);
  });

  it("compare 409s an incomplete run", async () => {
    makeRunDir("20260101120000");
    makeRunDir("20260102120000", { metadata: { status: "running" } });
    const app = await buildTestApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/sims/compare?builds=20260101120000,20260102120000",
    });
    expect(res.statusCode).toBe(409);
  });

  it("compare serves generated HTML then the cache on repeat", async () => {
    makeRunDir("20260101120000");
    makeRunDir("20260102120000");
    const spy = vi
      .spyOn(analysisPython, "runPythonComparison")
      .mockImplementation(async (_dirs: string[], cacheDir: string) => {
        fs.mkdirSync(cacheDir, { recursive: true });
        fs.writeFileSync(path.join(cacheDir, "comparison_dashboard.html"), "<html>cmp</html>");
      });
    const app = await buildTestApp();
    const url = "/api/sims/compare?builds=20260101120000,20260102120000";

    const r1 = await app.inject({ method: "GET", url });
    expect(r1.statusCode).toBe(200);
    expect(r1.headers["content-type"]).toMatch(/^text\/html/);
    expect(r1.body).toBe("<html>cmp</html>");

    const r2 = await app.inject({ method: "GET", url });
    expect(r2.statusCode).toBe(200);
    expect(r2.body).toBe("<html>cmp</html>");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("post bad teaminfo returns 400", async () => {
    const spy = vi.spyOn(runner, "runSimulationJob").mockResolvedValue(undefined);
    const app = await buildTestApp();
    const form = new FormData();
    form.append("export", Buffer.from(JSON.stringify({ players: [] })), {
      filename: "export.json",
      contentType: "application/json",
    });
    form.append("teaminfo", Buffer.from("{not json"), {
      filename: "teaminfo.json",
      contentType: "application/json",
    });
    form.append("config", JSON.stringify({ teams: [], seed: 1, runs: 10, n_workers: 1 }));
    const badJson = await app.inject({
      method: "POST",
      url: "/api/sims",
      payload: form.getBuffer() as Buffer,
      headers: form.getHeaders() as Record<string, string>,
    });
    expect(badJson.statusCode).toBe(400);

    const badShape = await multipartPost(
      app,
      { players: [] },
      { teams: [], seed: 1, runs: 10, n_workers: 1 },
      { "0": 1 } as unknown as object,
    );
    expect(badShape.statusCode).toBe(400);
    spy.mockRestore();
  });

  it("post omits n_workers and defaults in runner call", async () => {
    const spy = vi.spyOn(runner, "runSimulationJob").mockResolvedValue(undefined);
    const app = await buildTestApp();
    const form = new FormData();
    form.append("export", Buffer.from(JSON.stringify({ players: [{ stats: [], tid: 0 }] })), {
      filename: "export.json",
      contentType: "application/json",
    });
    form.append("config", JSON.stringify({ teams: [], seed: 2, runs: 5, compare: false }));
    const res = await app.inject({
      method: "POST",
      url: "/api/sims",
      payload: form.getBuffer() as Buffer,
      headers: form.getHeaders() as Record<string, string>,
    });
    expect(res.statusCode).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
    const args = spy.mock.calls[0]!;
    expect(args[4]).toBe(2);
    expect(args[5]).toBe(5);
    expect(args[6]).toBeGreaterThanOrEqual(1);
    spy.mockRestore();
  });

  it("post auto teaminfo", async () => {
    const spy = vi.spyOn(runner, "runSimulationJob").mockResolvedValue(undefined);
    const app = await buildTestApp();
    const exportPayload = {
      players: [
        { tid: 0, stats: [] },
        { tid: 1, stats: [] },
      ],
      teams: [
        { tid: 0, abbrev: "bos", active: true },
        { tid: 1, abbrev: "NYK", active: true },
        { tid: 2, abbrev: "OLD", active: false },
      ],
    };
    const form = new FormData();
    form.append("export", Buffer.from(JSON.stringify(exportPayload)), {
      filename: "export.json",
      contentType: "application/json",
    });
    form.append("config", JSON.stringify({ teams: [], seed: 1, runs: 10, n_workers: 1 }));
    const res = await app.inject({
      method: "POST",
      url: "/api/sims",
      payload: form.getBuffer() as Buffer,
      headers: form.getHeaders() as Record<string, string>,
    });
    expect(res.statusCode).toBe(200);
    const build = (JSON.parse(res.body) as { build: string }).build;
    const teaminfo = JSON.parse(
      fs.readFileSync(path.join(isolatedOutputsPath(), build, "teaminfo.json"), "utf8"),
    );
    expect(teaminfo).toEqual({
      "0": "BOS",
      "1": "NYK",
      "-1": "FA",
      "-2": "UDFA",
      "-3": "Retired",
    });
    const meta = JSON.parse(
      fs.readFileSync(path.join(isolatedOutputsPath(), build, "metadata.json"), "utf8"),
    );
    expect(meta.teaminfo_source).toBe("generated");
    spy.mockRestore();
  });
});
