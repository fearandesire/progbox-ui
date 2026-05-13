import { afterEach, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PROGRESS } from "./services/progress.js";

let tmpRoot: string | undefined;
let origOutputsDir: string | undefined;

/** Isolated outputs dir + cleared PROGRESS for Vitest. */
export function useIsolatedOutputs(): void {
  beforeEach(() => {
    origOutputsDir = process.env.PROGBOX_OUTPUTS_DIR;
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pb-out-"));
    process.env.PROGBOX_OUTPUTS_DIR = tmpRoot;
    PROGRESS.clear();
  });
  afterEach(() => {
    if (origOutputsDir !== undefined) {
      process.env.PROGBOX_OUTPUTS_DIR = origOutputsDir;
    } else {
      delete process.env.PROGBOX_OUTPUTS_DIR;
    }
    if (tmpRoot && fs.existsSync(tmpRoot)) {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
    PROGRESS.clear();
    tmpRoot = undefined;
  });
}

export function isolatedOutputsPath(): string {
  if (!tmpRoot) throw new Error("useIsolatedOutputs() not active");
  return tmpRoot;
}

export function baseMetadata(build: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    build,
    script_version: "v4.1",
    status: "complete",
    teams: [],
    seed: 1,
    runs: 1,
    n_workers: 1,
    export_file: `outputs/${build}/export.json`,
    teaminfo_file: `outputs/${build}/teaminfo.json`,
    started_at: "2026-01-01T12:00:00Z",
    completed_at: "2026-01-01T12:00:01Z",
    player_count: 2,
    config_snapshot: { ovr_hard_cap: 80 },
    error: null,
    ...overrides,
  };
}

export function makeRunDir(
  build: string,
  options: {
    metadata?: Record<string, unknown>;
    rawRows?: Record<string, unknown>[];
    charts?: string[];
    godprogs?: Record<string, unknown>[];
    extraFiles?: Record<string, string>;
  } = {},
): string {
  const root = isolatedOutputsPath();
  const runDir = path.join(root, build);
  fs.mkdirSync(runDir, { recursive: true });
  const payload = baseMetadata(build, options.metadata ?? {});
  fs.writeFileSync(path.join(runDir, "metadata.json"), JSON.stringify(payload, null, 2), "utf8");

  if (options.rawRows && options.rawRows.length > 0) {
    const rawDir = path.join(runDir, "raw");
    fs.mkdirSync(rawDir, { recursive: true });
    const header = Object.keys(options.rawRows[0]);
    const lines = [header.join(",")];
    for (const row of options.rawRows) {
      lines.push(header.map((h) => String(row[h] ?? "")).join(","));
    }
    fs.writeFileSync(path.join(rawDir, "outputs.csv"), lines.join("\n"), "utf8");
  }

  if (options.charts) {
    const chartsDir = path.join(runDir, "charts");
    fs.mkdirSync(chartsDir, { recursive: true });
    for (const name of options.charts) {
      fs.writeFileSync(path.join(chartsDir, name), "png");
    }
  }

  if (options.godprogs) {
    const rawDir = path.join(runDir, "raw");
    fs.mkdirSync(rawDir, { recursive: true });
    fs.writeFileSync(
      path.join(rawDir, "godprogs.json"),
      JSON.stringify(options.godprogs, null, 2),
      "utf8",
    );
  }

  if (options.extraFiles) {
    for (const [rel, content] of Object.entries(options.extraFiles)) {
      const target = path.join(runDir, rel);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content, "utf8");
    }
  }

  return runDir;
}
