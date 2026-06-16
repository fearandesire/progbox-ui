import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { outputsRoot } from "../paths.js";
import * as cppAdapter from "./cppAdapter.js";
import { setProgress } from "./progress.js";
import { computeRunStats } from "./simArtifacts.js";

export { PROGRESS, setProgress } from "./progress.js";

function utcNowIso(): string {
  return new Date().toISOString();
}

async function mergeMetadata(build: string, updates: Record<string, unknown>): Promise<void> {
  const out = outputsRoot();
  const metaPath = path.join(out, build, "metadata.json");
  let existing: Record<string, unknown> = {};
  try {
    if (fs.existsSync(metaPath)) {
      existing = JSON.parse(await fsp.readFile(metaPath, "utf8")) as Record<string, unknown>;
    }
  } catch {
    existing = {};
  }
  Object.assign(existing, updates);
  await fsp.mkdir(path.dirname(metaPath), { recursive: true });
  await fsp.writeFile(metaPath, JSON.stringify(existing, null, 2), "utf8");
}

export async function runSimulationJob(
  build: string,
  exportPath: string,
  teaminfoPath: string,
  teams: string[],
  seed: number,
  runs: number,
  n_workers: number,
): Promise<void> {
  const canonicalRunDir = path.join(outputsRoot(), build);
  await fsp.mkdir(canonicalRunDir, { recursive: true });

  try {
    setProgress(build, "parsing", 2, "Loading export…");
    await mergeMetadata(build, { status: "running" });

    setProgress(build, "simulating", 5, `Simulating (${runs} runs)…`);

    const onCppProgress = (cppPct: number, _message: string) => {
      const uiPct = 5 + cppPct * 0.75;
      setProgress(build, "simulating", uiPct, `Simulating (${Math.floor(cppPct)}%)`);
    };

    const stageMap: Record<string, [number, string, string]> = {
      cpp_done: [80, "analyzing", "Saving workbook…"],
      artifacts_copied: [85, "analyzing", "Copied artifacts."],
      analyzing: [88, "analyzing", "Generating analysis…"],
      analysis_done: [97, "analyzing", "Analysis complete."],
    };

    const onPostSimStage = (stage: string, message: string) => {
      const mapping = stageMap[stage];
      if (!mapping) return;
      const [pct, phase, defaultMsg] = mapping;
      setProgress(build, phase, pct, message || defaultMsg);
    };

    const playerCount = await cppAdapter.runCppSimulation({
      exportPath,
      teaminfoPath,
      teams,
      seed,
      runs,
      n_workers,
      canonicalRunDir,
      progressCallback: onCppProgress,
      stageCallback: onPostSimStage,
    });

    setProgress(build, "finalizing", 99, "Writing metadata…");
    let aggregateStats = {
      god_progs: null as number | null,
      mean_delta: null as number | null,
      severe_regressions: null as number | null,
    };
    try {
      aggregateStats = computeRunStats(build);
    } catch {
      // Run still completes; list rows show "—" for missing stats.
    }
    await mergeMetadata(build, {
      status: "complete",
      completed_at: utcNowIso(),
      player_count: playerCount,
      god_progs: aggregateStats.god_progs,
      mean_delta: aggregateStats.mean_delta,
      severe_regressions: aggregateStats.severe_regressions,
      error: null,
    });
    setProgress(build, "complete", 100, "Done.", true);
  } catch (exc: unknown) {
    const err = exc instanceof Error ? exc : new Error(String(exc));
    const tb = err.stack ?? String(exc);
    await mergeMetadata(build, {
      status: "failed",
      completed_at: utcNowIso(),
      error: `${err.name}: ${err.message}`,
    });
    setProgress(build, "failed", 0, `${err.name}: ${err.message}`, true);
    await mergeMetadata(build, { error_detail: tb.slice(0, 8000) });
  }
}
