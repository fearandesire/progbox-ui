import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { vendorCppDir } from "../paths.js";
import { generateAnalysis as generateStub } from "./analysisGenerate.js";

/** Vendored post-processor: 0/1 dir → single dashboard, 2+ dirs → comparison. */
function analysisPyPath(): string {
  return path.join(vendorCppDir(), "tools", "analysis.py");
}

/** Interpreter candidates: PROGBOX_PYTHON override, else platform defaults. */
function pythonCandidates(): string[] {
  const override = process.env.PROGBOX_PYTHON?.trim();
  if (override) return [override];
  return process.platform === "win32" ? ["python", "python3"] : ["python3", "python"];
}

type SpawnOutcome = { code: number; stderr: string } | "enoent";

function trySpawn(cmd: string, args: string[]): Promise<SpawnOutcome> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    const chunks: Buffer[] = [];
    let missing = false;
    proc.stderr?.on("data", (c: Buffer) => chunks.push(c));
    proc.on("error", (e: NodeJS.ErrnoException) => {
      if (e.code === "ENOENT") {
        missing = true;
        resolve("enoent");
      } else {
        reject(e);
      }
    });
    proc.on("close", (code) => {
      if (missing) return;
      resolve({ code: code ?? 1, stderr: Buffer.concat(chunks).toString("utf8") });
    });
  });
}

/** Run analysis.py with the given args; throws if no interpreter exists or the script fails. */
async function runAnalysisPy(args: string[]): Promise<void> {
  if (!fs.existsSync(analysisPyPath())) {
    throw new Error(`analysis.py not found at ${analysisPyPath()}`);
  }
  for (const cmd of pythonCandidates()) {
    const res = await trySpawn(cmd, [analysisPyPath(), ...args]);
    if (res === "enoent") continue; // interpreter missing — try the next candidate
    if (res.code === 0) return;
    throw new Error(`analysis.py failed (${cmd}, exit ${res.code}): ${res.stderr.slice(0, 2000)}`);
  }
  throw new Error("No Python interpreter found (set PROGBOX_PYTHON).");
}

/** Single-run dashboard: writes analysis.xlsx + analysis_dashboard.html into runDir. */
export async function runPythonSingle(runDir: string): Promise<void> {
  await runAnalysisPy([path.resolve(runDir)]);
}

/**
 * Comparison dashboard across 2+ run dirs. analysis.py writes
 * comparison_dashboard.html + comparison_scorecard.csv into run_dirs[0]; we
 * relocate both into cacheDir.
 * ponytail: relocate emitted files rather than patch the 4.9k-line vendored
 * analysis.py — keeps upstream re-vendoring clean. Ceiling: two comparisons
 * sharing run_dirs[0] concurrently could race; results are cache-keyed so
 * repeats skip, add a per-key lock if it ever matters.
 */
export async function runPythonComparison(runDirs: string[], cacheDir: string): Promise<void> {
  const resolved = runDirs.map((d) => path.resolve(d));
  await runAnalysisPy(resolved);
  await fsp.mkdir(cacheDir, { recursive: true });
  const firstDir = resolved[0]!;
  for (const name of ["comparison_dashboard.html", "comparison_scorecard.csv"]) {
    const src = path.join(firstDir, name);
    if (!fs.existsSync(src)) continue;
    const dst = path.join(cacheDir, name);
    try {
      await fsp.rename(src, dst);
    } catch {
      await fsp.copyFile(src, dst);
      await fsp.rm(src, { force: true });
    }
  }
}

/**
 * Generate the single-run analysis, preferring the real Python dashboard and
 * degrading to the TypeScript stub table if Python is unavailable/fails.
 * Never throws — a broken Python env degrades analysis, not the whole run.
 */
export async function runAnalysis(runDir: string): Promise<"python" | "fallback"> {
  try {
    await runPythonSingle(runDir);
    return "python";
  } catch (e) {
    console.error(
      "Python analysis failed; falling back to stub table:",
      e instanceof Error ? e.message : e,
    );
    await generateStub(runDir);
    return "fallback";
  }
}
