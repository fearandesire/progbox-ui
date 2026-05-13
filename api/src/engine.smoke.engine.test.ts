/**
 * Full C++ pipeline smoke — requires `pnpm build:engine` or `PROGBOX_CPP_BINARY`.
 * Excluded from default `pnpm test`; run via `pnpm test:api:engine`.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { resolveBinary } from "./services/cppAdapter.js";
import * as engineAdapter from "./services/engineAdapter.js";
import { PROGRESS } from "./services/runner.js";
import { runSimulationJob } from "./services/runner.js";

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

let hasBinary = false;
beforeAll(() => {
  try {
    resolveBinary();
    hasBinary = true;
  } catch {
    hasBinary = false;
  }
});

const ORIGINAL_PROGBOX_OUTPUTS = process.env.PROGBOX_OUTPUTS_DIR;

describe.skipIf(!hasBinary)("C++ engine smoke", () => {
  let prevOutputs: string | undefined;

  afterEach(() => {
    if (prevOutputs !== undefined) {
      process.env.PROGBOX_OUTPUTS_DIR = prevOutputs;
    } else if (ORIGINAL_PROGBOX_OUTPUTS !== undefined) {
      process.env.PROGBOX_OUTPUTS_DIR = ORIGINAL_PROGBOX_OUTPUTS;
    } else {
      delete process.env.PROGBOX_OUTPUTS_DIR;
    }
    PROGRESS.clear();
  });

  it("runs full pipeline", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "progbox-engine-"));
    prevOutputs = process.env.PROGBOX_OUTPUTS_DIR;
    const outputsDir = path.join(root, "outputs");
    process.env.PROGBOX_OUTPUTS_DIR = outputsDir;

    const build = "20260101120000";
    const runDir = path.join(outputsDir, build);
    fs.mkdirSync(runDir, { recursive: true });

    const exportPayload = sampleExport();
    const exportPath = path.join(runDir, "export.json");
    const teaminfoPath = path.join(runDir, "teaminfo.json");

    try {
      await fsp.writeFile(exportPath, JSON.stringify(exportPayload, null, 2), "utf8");
      await fsp.writeFile(teaminfoPath, JSON.stringify(sampleTeaminfo(), null, 2), "utf8");
      await fsp.writeFile(
        path.join(runDir, "metadata.json"),
        JSON.stringify({
          build,
          status: "running",
          script_version: engineAdapter.scriptVersion(),
          teams: [],
        }),
        "utf8",
      );

      await runSimulationJob(build, exportPath, teaminfoPath, [], 69, 2, 1);

      const metadata = JSON.parse(
        await fsp.readFile(path.join(runDir, "metadata.json"), "utf8"),
      ) as Record<string, unknown>;
      expect(metadata.build).toBe(build);
      expect(metadata.status).toBe("complete");
      expect(metadata.script_version).toBe(engineAdapter.scriptVersion());
      expect(metadata.player_count).toBe((exportPayload.players as unknown[]).length);
      expect(metadata.error).toBeNull();

      const outputsCsv = path.join(runDir, "raw", "outputs.csv");
      const analysisXlsx = path.join(runDir, "analysis.xlsx");
      const dashboardHtml = path.join(runDir, "analysis_dashboard.html");
      expect(fs.statSync(outputsCsv).size).toBeGreaterThan(0);
      expect(fs.statSync(analysisXlsx).size).toBeGreaterThan(0);
      expect(fs.statSync(dashboardHtml).size).toBeGreaterThan(0);

      const csvText = await fsp.readFile(outputsCsv, "utf8");
      const rows = parse(csvText, { columns: true, skip_empty_lines: true }) as Record<
        string,
        string
      >[];
      const cols = Object.keys(rows[0] ?? {});
      expect(cols.some((c) => c.startsWith("Unnamed"))).toBe(false);
      expect(cols).toContain("Run");
      const runs = new Set(rows.map((r) => r.Run));
      expect(runs.size).toBe(2);
      const pids = new Set(rows.map((r) => r.PlayerID));
      expect(pids.size).toBe((exportPayload.players as unknown[]).length);
      expect(rows.length).toBe(2 * (exportPayload.players as unknown[]).length);
    } finally {
      await fsp.rm(root, { recursive: true, force: true });
      if (prevOutputs !== undefined) {
        process.env.PROGBOX_OUTPUTS_DIR = prevOutputs;
      }
    }
  });

  it("filters to BOS when teams=['BOS']", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "progbox-engine-bos-"));
    prevOutputs = process.env.PROGBOX_OUTPUTS_DIR;
    const outputsDir = path.join(root, "outputs");
    process.env.PROGBOX_OUTPUTS_DIR = outputsDir;

    const build = "20260201120000";
    const runDir = path.join(outputsDir, build);
    fs.mkdirSync(runDir, { recursive: true });

    const exportPayload = sampleExport();
    const exportPath = path.join(runDir, "export.json");
    const teaminfoPath = path.join(runDir, "teaminfo.json");

    try {
      await fsp.writeFile(exportPath, JSON.stringify(exportPayload, null, 2), "utf8");
      await fsp.writeFile(teaminfoPath, JSON.stringify(sampleTeaminfo(), null, 2), "utf8");
      await fsp.writeFile(
        path.join(runDir, "metadata.json"),
        JSON.stringify({
          build,
          status: "running",
          script_version: engineAdapter.scriptVersion(),
          teams: ["BOS"],
        }),
        "utf8",
      );

      await runSimulationJob(build, exportPath, teaminfoPath, ["BOS"], 99, 2, 1);

      const metadata = JSON.parse(
        await fsp.readFile(path.join(runDir, "metadata.json"), "utf8"),
      ) as Record<string, unknown>;
      expect(metadata.status).toBe("complete");
      expect(metadata.error).toBeNull();

      const csvText = await fsp.readFile(path.join(runDir, "raw", "outputs.csv"), "utf8");
      const rows = parse(csvText, { columns: true, skip_empty_lines: true }) as Record<
        string,
        string
      >[];
      const teams = new Set(rows.map((r) => r.Team));
      expect(teams).toEqual(new Set(["BOS"]));
    } finally {
      await fsp.rm(root, { recursive: true, force: true });
      if (prevOutputs !== undefined) {
        process.env.PROGBOX_OUTPUTS_DIR = prevOutputs;
      }
    }
  });
});
