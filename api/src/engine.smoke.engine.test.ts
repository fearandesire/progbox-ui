/**
 * Full C++ pipeline smoke — requires `pnpm build:engine` or `PROGBOX_CPP_BINARY`.
 * Single-run analysis may use Python or the TypeScript fallback; comparison dashboards
 * still go through the existing Python path when available.
 * Excluded from default `pnpm test`; run via `pnpm test:api:engine`.
 */
import FormData from "form-data";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { resolveBinary } from "./services/cppAdapter.js";
import { runPythonComparison } from "./services/analysisPython.js";
import { PROGRESS, runSimulationJob } from "./services/runner.js";

const STUB_MARKER = "Monte Carlo outputs (sample)";

function sampleTeaminfo(): Record<string, string> {
  return { "0": "BOS", "1": "NYK", "2": "GSW", "3": "SAC" };
}

function player(
  pid: number,
  firstName: string,
  lastName: string,
  tid: number,
  bornYear: number,
  per: number,
  dws: number,
  ewa: number,
): Record<string, unknown> {
  const attrs: Record<string, number> = {
    dIQ: 54,
    Dnk: 50,
    Drb: 51,
    End: 52,
    "2Pt": 53,
    FT: 54,
    Ins: 55,
    Jmp: 56,
    oIQ: 57,
    Pss: 58,
    Reb: 59,
    Spd: 60,
    Str: 61,
    "3Pt": 62,
    Hgt: 63,
    Ovr: 55,
  };
  return {
    pid,
    firstName,
    lastName,
    tid,
    born: { year: bornYear, loc: "USA" },
    stats: [{ per, dws, ewa, playoffs: false, gp: 82 }],
    ratings: [attrs],
  };
}

function sampleExport(): Record<string, unknown> {
  return {
    version: 68,
    meta: { name: "Fixture League" },
    gameAttributes: { season: 2024, phase: "regularSeason" },
    players: [
      player(0, "Alpha", "One", 0, 1992, 10.0, 1.0, 0.5),
      player(1, "Beta", "Two", 1, 1992, 14.0, 1.2, 0.7),
      player(2, "Gamma", "Three", 2, 1992, 18.0, 1.6, 1.0),
      player(3, "Delta", "Four", 3, 1992, 22.0, 1.8, 1.2),
      player(4, "Epsilon", "Five", 0, 1992, 26.0, 2.0, 1.4),
      player(5, "Zeta", "Six", 1, 1992, 30.0, 2.2, 1.6),
    ],
    teaminfo: sampleTeaminfo(),
  };
}

/** Seed a run dir with export/teaminfo/metadata and drive the full pipeline. */
async function driveRun(
  outputsDir: string,
  build: string,
  teams: string[],
  seed: number,
): Promise<string> {
  const runDir = path.join(outputsDir, build);
  fs.mkdirSync(runDir, { recursive: true });
  const exportPath = path.join(runDir, "export.json");
  const teaminfoPath = path.join(runDir, "teaminfo.json");
  await fsp.writeFile(exportPath, JSON.stringify(sampleExport(), null, 2), "utf8");
  await fsp.writeFile(teaminfoPath, JSON.stringify(sampleTeaminfo(), null, 2), "utf8");
  await fsp.writeFile(
    path.join(runDir, "metadata.json"),
    JSON.stringify({ build, status: "running", teams }),
    "utf8",
  );
  await runSimulationJob(build, exportPath, teaminfoPath, teams, seed, 2, 1);
  return runDir;
}

function readMeta(runDir: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(runDir, "metadata.json"), "utf8")) as Record<
    string,
    unknown
  >;
}

// Resolve at collection time — describe.skipIf() is evaluated before beforeAll runs.
let hasBinary = false;
try {
  resolveBinary();
  hasBinary = true;
} catch {
  hasBinary = false;
}

const ORIGINAL_PROGBOX_OUTPUTS = process.env.PROGBOX_OUTPUTS_DIR;
const ORIGINAL_PROGBOX_PYTHON = process.env.PROGBOX_PYTHON;

describe.skipIf(!hasBinary)("C++ engine smoke", () => {
  afterEach(() => {
    if (ORIGINAL_PROGBOX_OUTPUTS !== undefined) {
      process.env.PROGBOX_OUTPUTS_DIR = ORIGINAL_PROGBOX_OUTPUTS;
    } else {
      delete process.env.PROGBOX_OUTPUTS_DIR;
    }
    if (ORIGINAL_PROGBOX_PYTHON !== undefined) {
      process.env.PROGBOX_PYTHON = ORIGINAL_PROGBOX_PYTHON;
    } else {
      delete process.env.PROGBOX_PYTHON;
    }
    PROGRESS.clear();
  });

  it("runs a real v4.3 run and produces the interactive Plotly dashboard", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "progbox-engine-"));
    const outputsDir = path.join(root, "outputs");
    process.env.PROGBOX_OUTPUTS_DIR = outputsDir;
    const build = "20260101120000";

    try {
      const runDir = await driveRun(outputsDir, build, [], 69);
      const metadata = readMeta(runDir);

      expect(metadata.build).toBe(build);
      expect(metadata.status).toBe("complete");
      expect(metadata.error).toBeNull();
      expect(metadata.player_count).toBe(6);

      // Executed truth patched from the engine's own metadata (default version = v4.3).
      expect((metadata.progression as { id?: string } | undefined)?.id).toBe("v43");
      expect(typeof metadata.script_version).toBe("string");

      // The real Python dashboard, not the TS stub table.
      expect(metadata.analysis_engine).toBe("python");
      const dashboardHtml = path.join(runDir, "analysis_dashboard.html");
      const html = await fsp.readFile(dashboardHtml, "utf8");
      expect(html.length).toBeGreaterThan(0);
      expect(html).not.toContain(STUB_MARKER);
      expect(html.toLowerCase()).toContain("plotly");

      const analysisXlsx = path.join(runDir, "analysis.xlsx");
      expect(fs.statSync(analysisXlsx).size).toBeGreaterThan(0);

      const outputsCsv = path.join(runDir, "raw", "outputs.csv");
      const rows = parse(await fsp.readFile(outputsCsv, "utf8"), {
        columns: true,
        skip_empty_lines: true,
      }) as Record<string, string>[];
      const cols = Object.keys(rows[0] ?? {});
      expect(cols.some((c) => c.startsWith("Unnamed"))).toBe(false);
      expect(cols).toContain("Run");
      expect(new Set(rows.map((r) => r.Run)).size).toBe(2);
      expect(new Set(rows.map((r) => r.PlayerID)).size).toBe(6);
      expect(rows.length).toBe(12);
    } finally {
      await fsp.rm(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("filters to BOS when teams=['BOS']", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "progbox-engine-bos-"));
    const outputsDir = path.join(root, "outputs");
    process.env.PROGBOX_OUTPUTS_DIR = outputsDir;

    try {
      const runDir = await driveRun(outputsDir, "20260201120000", ["BOS"], 99);
      const metadata = readMeta(runDir);
      expect(metadata.status).toBe("complete");
      expect(metadata.error).toBeNull();

      const rows = parse(await fsp.readFile(path.join(runDir, "raw", "outputs.csv"), "utf8"), {
        columns: true,
        skip_empty_lines: true,
      }) as Record<string, string>[];
      expect(new Set(rows.map((r) => r.Team))).toEqual(new Set(["BOS"]));
    } finally {
      await fsp.rm(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("degrades to the stub table when Python is unavailable", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "progbox-engine-fallback-"));
    const outputsDir = path.join(root, "outputs");
    process.env.PROGBOX_OUTPUTS_DIR = outputsDir;
    process.env.PROGBOX_PYTHON = path.join(root, "no-such-python");

    try {
      const runDir = await driveRun(outputsDir, "20260301120000", [], 69);
      const metadata = readMeta(runDir);
      expect(metadata.status).toBe("complete");
      expect(metadata.analysis_engine).toBe("fallback");

      const html = await fsp.readFile(path.join(runDir, "analysis_dashboard.html"), "utf8");
      expect(html).toContain(STUB_MARKER);
    } finally {
      await fsp.rm(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("produces a comparison scorecard across two runs", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "progbox-engine-compare-"));
    const outputsDir = path.join(root, "outputs");
    process.env.PROGBOX_OUTPUTS_DIR = outputsDir;

    try {
      const dirA = await driveRun(outputsDir, "20260401120000", [], 69);
      const dirB = await driveRun(outputsDir, "20260401130000", [], 70);
      const cacheDir = path.join(outputsDir, "comparisons", "20260401120000_20260401130000");

      await runPythonComparison([dirA, dirB], cacheDir);

      const html = path.join(cacheDir, "comparison_dashboard.html");
      expect(fs.statSync(html).size).toBeGreaterThan(0);
      expect(fs.existsSync(path.join(cacheDir, "comparison_scorecard.csv"))).toBe(true);
      expect((await fsp.readFile(html, "utf8")).toLowerCase()).toContain("plotly");
    } finally {
      await fsp.rm(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("public POST /api/sims paired path schedules both versions and serves compare GET", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "progbox-engine-pair-api-"));
    const outputsDir = path.join(root, "outputs");
    process.env.PROGBOX_OUTPUTS_DIR = outputsDir;

    const pending: Promise<unknown>[] = [];
    const app = await buildApp({
      scheduleBackground: (task) => {
        pending.push(Promise.resolve(task()));
      },
    });

    try {
      const form = new FormData();
      form.append("export", Buffer.from(JSON.stringify(sampleExport())), {
        filename: "export.json",
        contentType: "application/json",
      });
      form.append("teaminfo", Buffer.from(JSON.stringify(sampleTeaminfo())), {
        filename: "teaminfo.json",
        contentType: "application/json",
      });
      form.append(
        "config",
        JSON.stringify({
          teams: [],
          seed: 42,
          runs: 2,
          n_workers: 1,
          version: "v43",
          compare: true,
        }),
      );

      const res = await app.inject({
        method: "POST",
        url: "/api/sims",
        payload: form.getBuffer() as Buffer,
        headers: form.getHeaders() as Record<string, string>,
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as {
        build: string;
        compare_build: string;
        pair_id: string;
      };
      expect(body.build).toHaveLength(14);
      expect(body.compare_build).toHaveLength(14);
      expect(body.compare_build).not.toBe(body.build);
      expect(body.pair_id).toBe(body.build);

      await Promise.all(pending);

      const primaryMeta = readMeta(path.join(outputsDir, body.build));
      const baselineMeta = readMeta(path.join(outputsDir, body.compare_build));
      expect(primaryMeta.status).toBe("complete");
      expect(baselineMeta.status).toBe("complete");
      expect(primaryMeta.pair_id).toBe(body.pair_id);
      expect(baselineMeta.pair_id).toBe(body.pair_id);
      expect(primaryMeta.pair_role).toBe("primary");
      expect(baselineMeta.pair_role).toBe("baseline");
      expect(primaryMeta.paired_with).toBe(body.compare_build);
      expect(baselineMeta.paired_with).toBe(body.build);
      expect(primaryMeta.requested_version).toBe("v43");
      expect(baselineMeta.requested_version).toBe("v41");
      // Analysis may be Python or the TS fallback — do not require Python for pairing.
      expect(["python", "fallback"]).toContain(primaryMeta.analysis_engine);
      expect(["python", "fallback"]).toContain(baselineMeta.analysis_engine);

      const compare = await app.inject({
        method: "GET",
        url: `/api/sims/compare?builds=${body.build},${body.compare_build}`,
      });
      if (compare.statusCode === 200) {
        expect(compare.headers["content-type"]).toMatch(/^text\/html/);
        expect(compare.body.length).toBeGreaterThan(0);
      } else {
        // Comparison dashboard still uses the Python tooling; pairing itself already passed.
        expect(compare.statusCode).toBe(500);
        expect(String(compare.body)).toMatch(/Comparison generation failed|Python/i);
      }
    } finally {
      await app.close();
      await fsp.rm(root, { recursive: true, force: true });
    }
  }, 180_000);
});
