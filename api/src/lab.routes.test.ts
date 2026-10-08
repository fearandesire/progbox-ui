import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import FormData from "form-data";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

import { spawn } from "node:child_process";
import { buildApp } from "./app.js";

class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  kill = vi.fn();
  constructor(readonly args: string[]) {
    super();
  }
  /** Write stdout lines now (they reach readline immediately). */
  emitLines(...lines: unknown[]) {
    for (const l of lines) this.stdout.write(`${typeof l === "string" ? l : JSON.stringify(l)}\n`);
  }
  finish(stdout = "", code = 0, stderr = "") {
    this.stdout.end(stdout);
    this.stderr.end(stderr);
    setTimeout(() => this.emit("close", code), 5);
  }
}

type Handler = (child: FakeChild) => void;
let children: FakeChild[] = [];
let handler: Handler = (c) => c.finish("[]");

/** CLI args after `node [flags] cli.ts`. */
const cliArgs = (c: FakeChild) => c.args.slice(c.args.findIndex((a) => a.endsWith("cli.ts")) + 1);

let dataDir: string;
let origDataDir: string | undefined;
const apps: FastifyInstance[] = [];

beforeEach(() => {
  origDataDir = process.env.LAB_DATA_DIR;
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lab-data-"));
  process.env.LAB_DATA_DIR = dataDir;
  children = [];
  handler = (c) => c.finish("[]");
  vi.mocked(spawn).mockImplementation(((_cmd: string, args: string[]) => {
    const child = new FakeChild(args);
    children.push(child);
    setImmediate(() => handler(child));
    return child;
  }) as unknown as typeof spawn);
});

afterEach(async () => {
  await Promise.all(apps.map((a) => a.close()));
  apps.length = 0;
  if (origDataDir === undefined) delete process.env.LAB_DATA_DIR;
  else process.env.LAB_DATA_DIR = origDataDir;
  fs.rmSync(dataDir, { recursive: true, force: true });
  vi.mocked(spawn).mockReset();
});

async function app() {
  const a = await buildApp();
  apps.push(a);
  return a;
}

const until = async (fn: () => boolean, ms = 2000) => {
  const t = Date.now();
  while (!fn()) {
    if (Date.now() - t > ms) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 5));
  }
};

/** Lay down the files a finished CLI run writes. */
function writeRun(runId: string, extra: Record<string, unknown> = {}) {
  const dir = path.join(dataDir, "runs", runId);
  fs.mkdirSync(dir, { recursive: true });
  const status = { runId, state: "done", mode: "quick", script: "net@4.3.0", baseline: "net@3.2.1", league: "progbox-2017", startedAt: "2026-10-08T00:00:00Z", verdict: "Review flags", ...extra };
  fs.writeFileSync(path.join(dir, "status.json"), JSON.stringify(status));
  fs.writeFileSync(path.join(dir, "report.json"), JSON.stringify({ verdict: "Review flags", flags: [{ level: "warn", text: "God progs" }] }));
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ run_id: runId }));
  fs.writeFileSync(path.join(dir, "summary.md"), "# NET Lab: net@4.3.0\n");
  fs.writeFileSync(path.join(dir, "players.csv"), 'pid,name,tid,age,per,meanDelta,d_hgt,d_spd\n1,"Doe, Jo",3,25,15.5,1.25,0.0000,2.5000\n2,Ann,4,31,,-2,0,-1\n');
  return dir;
}

describe("lab routes: registry and leagues", () => {
  it("lists scripts through `scripts list --json`", async () => {
    handler = (c) => c.finish(JSON.stringify([{ id: "net@3.2.1", role: "published" }]));
    const res = await (await app()).inject({ method: "GET", url: "/api/lab/scripts" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([{ id: "net@3.2.1", role: "published" }]);
    expect(cliArgs(children[0]!)).toEqual(["scripts", "list", "--json"]);
    expect(vi.mocked(spawn).mock.calls[0]![2]).toMatchObject({ cwd: dataDir, env: expect.objectContaining({ LAB_DATA_DIR: dataDir }) });
  });

  it("adds a script from JSON via a temp file and returns the forced id", async () => {
    let written = "";
    handler = (c) => {
      const args = cliArgs(c);
      written = fs.readFileSync(args[2]!, "utf8");
      c.finish(JSON.stringify({ entry: { id: "net@4.4.0-draft.1" }, created: true, notes: ["Saved as net@4.4.0-draft.1."] }));
    };
    const res = await (await app()).inject({ method: "POST", url: "/api/lab/scripts", payload: { source: "bbgm.player.develop()", filename: "../wip.js", family: "net" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().entry.id).toBe("net@4.4.0-draft.1");
    const args = cliArgs(children[0]!);
    expect(args.slice(0, 2)).toEqual(["scripts", "add"]);
    expect(path.basename(args[2]!)).toBe("wip.js");
    expect(args.slice(3)).toEqual(["--family", "net", "--json"]);
    expect(written).toBe("bbgm.player.develop()");
    expect(fs.existsSync(args[2]!)).toBe(false);
  });

  it("adds a script from a multipart upload", async () => {
    handler = (c) => c.finish(JSON.stringify({ entry: { id: "hooks@0.0.0-draft.1" }, created: false, notes: ["Same code as hooks@0.0.0-draft.1; reusing it."] }));
    const form = new FormData();
    form.append("family", "hooks");
    form.append("file", Buffer.from("// v1\n"), { filename: "x.js", contentType: "text/javascript" });
    const res = await (await app()).inject({ method: "POST", url: "/api/lab/scripts", payload: form.getBuffer(), headers: form.getHeaders() });
    expect(res.statusCode).toBe(200);
    expect(res.json().created).toBe(false);
    expect(cliArgs(children[0]!)).toContain("hooks");
  });

  it("rejects a bad family without calling the CLI", async () => {
    const res = await (await app()).inject({ method: "POST", url: "/api/lab/scripts", payload: { source: "x", family: "--role" } });
    expect(res.statusCode).toBe(422);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("surfaces CLI errors as 422 with the CLI's message", async () => {
    handler = (c) => c.finish("", 1, "(node:1) ExperimentalWarning: noise\nLeague not found: nope\n");
    const res = await (await app()).inject({ method: "GET", url: "/api/lab/leagues/nope/check" });
    expect(res.statusCode).toBe(422);
    expect(res.json().detail).toBe("League not found: nope");
    expect(cliArgs(children[0]!)).toEqual(["leagues", "check", "nope", "--json"]);
  });

  it("refuses league ids that look like paths", async () => {
    const res = await (await app()).inject({ method: "GET", url: "/api/lab/leagues/..%2Fetc/check" });
    expect(res.statusCode).toBe(422);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("uploads a league export and returns its validation", async () => {
    handler = (c) => {
      const args = cliArgs(c);
      expect(fs.readFileSync(args[2]!, "utf8")).toBe('{"players":[]}');
      c.finish(JSON.stringify({ league: { id: "upload-abc" }, validation: { ok: false, issues: [{ level: "error", code: "no-players", text: "The export has no players." }] } }));
    };
    const form = new FormData();
    form.append("name", "My league");
    form.append("file", Buffer.from('{"players":[]}'), { filename: "league.json", contentType: "application/json" });
    const res = await (await app()).inject({ method: "POST", url: "/api/lab/leagues", payload: form.getBuffer(), headers: form.getHeaders() });
    expect(res.statusCode).toBe(200);
    expect(res.json().validation.ok).toBe(false);
    expect(cliArgs(children[0]!).slice(3)).toEqual(["--name", "My league"]);
  });

  it("estimates with the measured CLI estimate and enforces locked sizes", async () => {
    handler = (c) => c.finish(JSON.stringify({ seconds: 42, basis: ["quick: 500 ms per offseason"] }));
    const a = await app();
    const res = await a.inject({ method: "GET", url: "/api/lab/estimate?script=net-4.3.0&baseline=net-3.2.1&mode=quick&unlock=1&runs=40" });
    expect(res.json()).toEqual({ seconds: 42, basis: ["quick: 500 ms per offseason"] });
    expect(cliArgs(children[0]!)).toEqual(["estimate", "--script", "net-4.3.0", "--mode", "quick", "--baseline", "net-3.2.1", "--unlock", "--runs", "40"]);
    const locked = await a.inject({ method: "GET", url: "/api/lab/estimate?script=net-4.3.0&runs=40" });
    expect(locked.statusCode).toBe(422);
    expect(locked.json().detail).toMatch(/locked/);
  });
});

describe("lab routes: runs", () => {
  it("starts a run, queues the next one, and serves results when done", async () => {
    const runs: FakeChild[] = [];
    handler = (c) => {
      runs.push(c);
      const runId = runs.length === 1 ? "20261008000001" : "20261008000002";
      fs.mkdirSync(path.join(dataDir, "runs", runId), { recursive: true });
      fs.writeFileSync(path.join(dataDir, "runs", runId, "status.json"), JSON.stringify({ runId, state: "running", script: "net@4.3.0", mode: "quick" }));
      c.emitLines(
        { type: "run", runId, dir: "/x", estimateSeconds: 15, estimateBasis: ["quick: 500 ms"] },
        { type: "stage", stage: "ingest", text: "Checking the league" },
        { type: "issue", level: "warn", code: "short-rosters", text: "11 teams short" },
        { type: "stage", stage: "quick:net@4.3.0", text: "40 offseasons" },
        { type: "progress", stage: "quick:net@4.3.0", done: 10, total: 40, elapsed: 2.5 },
      );
    };
    const a = await app();
    const first = await a.inject({ method: "POST", url: "/api/lab/runs", payload: { mode: "quick", script: "net-4.3.0", baseline: "net-3.2.1", league: "progbox-2017", seed: 7, unlock: { runs: 40 } } });
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({ runId: "20261008000001", state: "running", estimateSeconds: 15 });
    expect(cliArgs(runs[0]!)).toEqual(["run", "--json", "--mode", "quick", "--script", "net-4.3.0", "--baseline", "net-3.2.1", "--league", "progbox-2017", "--seed", "7", "--unlock", "--runs", "40"]);

    const second = await a.inject({ method: "POST", url: "/api/lab/runs", payload: { script: "net-4.3.0" } });
    expect(second.statusCode).toBe(202);
    expect(second.json()).toMatchObject({ runId: null, state: "queued", position: 1 });
    expect(runs).toHaveLength(1);

    const live = (await a.inject({ method: "GET", url: "/api/lab/runs/20261008000001" })).json();
    expect(live).toMatchObject({ state: "running", script: "net@4.3.0", estimateBasis: ["quick: 500 ms"], issues: [{ code: "short-rosters" }], results: null });
    expect(live.stages[1]).toMatchObject({ stage: "quick:net@4.3.0", done: 10, total: 40 });

    const queued = (await a.inject({ method: "GET", url: `/api/lab/runs/${second.json().queueId}` })).json();
    expect(queued).toMatchObject({ state: "queued", position: 1, runId: null });
    const history = (await a.inject({ method: "GET", url: "/api/lab/runs" })).json();
    expect(history[0]).toMatchObject({ state: "queued", script: "net-4.3.0" });

    writeRun("20261008000001");
    runs[0]!.emitLines({ type: "done", runId: "20261008000001", dir: "/x", verdict: "Review flags", seconds: 12 });
    runs[0]!.finish();
    await until(() => runs.length === 2);
    expect(cliArgs(runs[1]!)).toEqual(["run", "--json", "--mode", "deep", "--script", "net-4.3.0"]);

    const done = (await a.inject({ method: "GET", url: "/api/lab/runs/20261008000001" })).json();
    expect(done.state).toBe("done");
    expect(done.results.report.verdict).toBe("Review flags");
    expect(done.results.summary).toContain("NET Lab");
    expect(done.results.players.script[0]).toMatchObject({ name: "Doe, Jo", age: 25, per: 15.5, attrDelta: { hgt: 0, spd: 2.5 } });
    expect(done.results.players.script[1].per).toBeNull();
    expect(done.results.players.baseline).toBeNull();
    expect(done.results.replayCommand).toBe(`pnpm lab replay ${path.join(dataDir, "runs", "20261008000001", "manifest.json")}`);
    expect(done.results.files).toEqual(expect.arrayContaining(["summary.md", "report.json", "players.csv", "manifest.json"]));

    const resolved = (await a.inject({ method: "GET", url: `/api/lab/runs/${second.json().queueId}` })).json();
    expect(resolved.runId).toBe("20261008000002");
    runs[1]!.finish("", 1, "boom");
    await until(() => JSON.parse(fs.readFileSync(path.join(dataDir, "runs", "20261008000002", "status.json"), "utf8")).state === "failed");
    const failed = (await a.inject({ method: "GET", url: "/api/lab/runs/20261008000002" })).json();
    expect(failed).toMatchObject({ state: "failed", error: "boom" });
  });

  it("returns 422 when the CLI fails before a run starts", async () => {
    handler = (c) => {
      c.emitLines({ type: "error", message: "Unknown script nope: not a registry id, builtin or file." });
      c.finish("", 1);
    };
    const res = await (await app()).inject({ method: "POST", url: "/api/lab/runs", payload: { script: "nope" } });
    expect(res.statusCode).toBe(422);
    expect(res.json().detail).toMatch(/Unknown script nope/);
  });

  it("validates run bodies", async () => {
    const a = await app();
    for (const payload of [{ script: "../x.js" }, { script: "--help" }, { script: "net-4.3.0", mode: "slow" }, { script: "net-4.3.0", unlock: { runs: 0 } }, { script: "net-4.3.0", workers: 3 }]) {
      const res = await a.inject({ method: "POST", url: "/api/lab/runs", payload });
      expect(res.statusCode, JSON.stringify(payload)).toBe(422);
    }
    expect(spawn).not.toHaveBeenCalled();
  });

  it("lists history from status.json and serves only known files", async () => {
    writeRun("20261008000001");
    writeRun("20261008000009", { verdict: "No flags" });
    fs.mkdirSync(path.join(dataDir, "runs", "crosscheck"), { recursive: true });
    const a = await app();
    const list = (await a.inject({ method: "GET", url: "/api/lab/runs" })).json();
    expect(list.map((r: { runId: string }) => r.runId)).toEqual(["20261008000009", "20261008000001"]);

    const file = await a.inject({ method: "GET", url: "/api/lab/runs/20261008000001/files/summary.md" });
    expect(file.statusCode).toBe(200);
    expect(file.headers["content-disposition"]).toContain("20261008000001-summary.md");
    expect(file.body).toContain("# NET Lab");
    expect((await a.inject({ method: "GET", url: "/api/lab/runs/20261008000001/files/secret.txt" })).statusCode).toBe(404);
    expect((await a.inject({ method: "GET", url: "/api/lab/runs/20261008000001/files/deep.json" })).statusCode).toBe(404);
    expect((await a.inject({ method: "GET", url: "/api/lab/runs/..%2F..%2Fx/files/summary.md" })).statusCode).toBe(422);
    expect((await a.inject({ method: "GET", url: "/api/lab/runs/20990101000000" })).statusCode).toBe(404);
  });
});
