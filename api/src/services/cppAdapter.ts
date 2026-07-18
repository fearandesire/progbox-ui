import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { vendorCppDir } from "../paths.js";
import { normalizeSeason } from "../utils/normalizeSeason.js";
import { buildInputRows, rowsToCsv } from "./exportCleaner.js";
import { runAnalysis } from "./analysisPython.js";

const VENDOR_DIR = vendorCppDir();
const _BINARY_CANDIDATES = [
  path.join(VENDOR_DIR, "build", process.platform === "win32" ? "progbox.exe" : "progbox"),
  path.join(VENDOR_DIR, "build", "progbox"),
  path.join(VENDOR_DIR, "build", "progbox.exe"),
  path.join(VENDOR_DIR, "build", "Release", "progbox.exe"),
  path.join(VENDOR_DIR, "build", "Release", "progbox"),
  path.join(VENDOR_DIR, "build", "x64", "Release", "progbox.exe"),
  path.join(VENDOR_DIR, "build", "x64", "Release", "progbox"),
];

export function resolveBinary(): string {
  const override = process.env.PROGBOX_CPP_BINARY?.trim();
  if (override) {
    if (!fs.existsSync(override)) {
      throw new Error(`PROGBOX_CPP_BINARY=${JSON.stringify(override)} does not exist`);
    }
    return override;
  }
  for (const c of _BINARY_CANDIDATES) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error("C++ progbox binary not found. Run `pnpm build:engine` or set PROGBOX_CPP_BINARY.");
}

export function getSeason(exportPath: string): number {
  const data = JSON.parse(fs.readFileSync(exportPath, "utf8")) as Record<string, unknown>;
  const raw = (data.gameAttributes as Record<string, unknown> | undefined)?.season;
  return normalizeSeason(raw);
}

export function filterExport(
  exportPath: string,
  teaminfoPath: string,
  teams: string[],
): Record<string, unknown> {
  const data = JSON.parse(fs.readFileSync(exportPath, "utf8")) as Record<string, unknown>;
  if (!teams.length) return data;
  const teaminfo = JSON.parse(fs.readFileSync(teaminfoPath, "utf8")) as Record<string, string>;
  const allowedTids = new Set<number>();
  for (const [tid, abbr] of Object.entries(teaminfo)) {
    if (teams.includes(abbr)) {
      allowedTids.add(parseInt(tid, 10));
    }
  }
  const players = (data.players as unknown[]) ?? [];
  data.players = players.filter((p) => {
    if (!p || typeof p !== "object") return false;
    const tid = (p as Record<string, unknown>).tid;
    return typeof tid === "number" && allowedTids.has(tid);
  });
  return data;
}

export function writeInputCsv(
  workspace: string,
  exportPath: string,
  teaminfoPath: string,
  teams: string[],
): number {
  const exportData = JSON.parse(fs.readFileSync(exportPath, "utf8")) as Record<string, unknown>;
  const teamLookup = JSON.parse(fs.readFileSync(teaminfoPath, "utf8")) as Record<string, string>;
  const rows = buildInputRows(exportData, teamLookup, teams);
  const dataDir = path.join(workspace, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, "input.csv"), rowsToCsv(rows), "utf8");
  return rows.length;
}

const PROGRESS_RE = /(\d+)\/(\d+)\s*\(\s*(\d+)\s*%\)/;

async function streamCppProgress(
  stdout: NodeJS.ReadableStream | null,
  progressCallback?: (pct: number, message: string) => void,
): Promise<void> {
  if (!stdout) return;
  let buf = "";
  let lastPct = -1;
  for await (const chunk of stdout) {
    const s = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    buf += s;
    const parts = buf.split(/\r?\n/);
    buf = parts.pop() ?? "";
    for (const line of parts) {
      const decoded = line.trim();
      if (!decoded) continue;
      const m = decoded.match(PROGRESS_RE);
      if (m && progressCallback) {
        const cppPct = parseInt(m[3]!, 10);
        if (cppPct !== lastPct) {
          lastPct = cppPct;
          progressCallback(cppPct, decoded);
        }
      }
    }
  }
}

export function findCppOutputDir(base: string): string {
  const subdirs = fs
    .readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(base, d.name));
  if (subdirs.length !== 1) {
    throw new Error(
      `Expected exactly 1 C++ output directory in ${base}, found ${subdirs.length}: ${subdirs.map((p) => path.basename(p)).join(", ")}`,
    );
  }
  return subdirs[0]!;
}

export interface RunCppOptions {
  exportPath: string;
  teaminfoPath: string;
  teams: string[];
  seed: number;
  runs: number;
  n_workers: number;
  canonicalRunDir: string;
  progressCallback?: (pct: number, message: string) => void;
  stageCallback?: (stage: string, message: string) => void;
  version?: string;
}

export interface RunCppResult {
  playerCount: number;
  analysisEngine: "python" | "fallback";
}

export async function runCppSimulation(opts: RunCppOptions): Promise<RunCppResult> {
  const emitStage = (name: string, message: string) => {
    opts.stageCallback?.(name, message);
  };

  const binary = resolveBinary();
  const canonicalRunDir = opts.canonicalRunDir;
  const cppOutputsBase = path.join(canonicalRunDir, "_cpp_tmp_outputs");
  fs.mkdirSync(cppOutputsBase, { recursive: true });

  try {
    const workspace = await fsp.mkdtemp(path.join(os.tmpdir(), "progbox_cpp_"));

    try {
      const playerCount = writeInputCsv(
        workspace,
        opts.exportPath,
        opts.teaminfoPath,
        opts.teams,
      );

      let effectiveExport = path.resolve(opts.exportPath);
      if (opts.teams.length > 0) {
        const filtered = filterExport(opts.exportPath, opts.teaminfoPath, opts.teams);
        effectiveExport = path.join(workspace, "export_filtered.json");
        await fsp.writeFile(effectiveExport, JSON.stringify(filtered), "utf8");
      }

      const seasonY = getSeason(opts.exportPath);

      const cmd = [
        binary,
        effectiveExport,
        path.resolve(opts.teaminfoPath),
        path.resolve(cppOutputsBase),
        "-v",
        opts.version ?? "v41",
        "-r",
        String(opts.runs),
        "-w",
        String(opts.n_workers),
        "-s",
        String(opts.seed),
        "-y",
        String(seasonY),
      ];

      const proc = spawn(cmd[0]!, cmd.slice(1), {
        cwd: workspace,
        stdio: ["ignore", "pipe", "pipe"],
      });

      const stderrChunks: Buffer[] = [];
      proc.stderr?.on("data", (c: Buffer) => stderrChunks.push(c));

      await Promise.all([
        streamCppProgress(proc.stdout, opts.progressCallback),
        once(proc, "close"),
      ]);
      const code = proc.exitCode ?? 1;
      if (code !== 0) {
        const errText = Buffer.concat(stderrChunks).toString("utf8");
        throw new Error(`C++ binary exited with code ${code}${errText ? `: ${errText}` : ""}`);
      }

      emitStage("cpp_done", "Saving workbook…");

      const cppRunDir = findCppOutputDir(cppOutputsBase);
      const rawDst = path.join(canonicalRunDir, "raw");
      if (fs.existsSync(rawDst)) {
        await fsp.rm(rawDst, { recursive: true, force: true });
      }
      await fsp.cp(path.join(cppRunDir, "raw"), rawDst, { recursive: true });

      const cppMetaSrc = path.join(cppRunDir, "metadata.json");
      if (fs.existsSync(cppMetaSrc)) {
        await fsp.copyFile(cppMetaSrc, path.join(canonicalRunDir, "engine_metadata.json"));
      }

      emitStage("artifacts_copied", "Copied artifacts.");
      emitStage("analyzing", "Generating analysis…");
      const analysisEngine = await runAnalysis(canonicalRunDir);
      emitStage("analysis_done", "Analysis complete.");

      return { playerCount, analysisEngine };
    } finally {
      await fsp.rm(workspace, { recursive: true, force: true }).catch(() => {});
    }
  } finally {
    await fsp.rm(cppOutputsBase, { recursive: true, force: true }).catch(() => {});
  }
}
