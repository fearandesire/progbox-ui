import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { analyze, type Analysis } from "./analyze.ts";
import { COMPAT_TARGET } from "./compat.ts";
import { loadModel, runReplicate, type DeepJob } from "./deep.ts";
import { analyzeDeep, deepFlags, deepMarkdown, type DeepAnalysis } from "./deepAnalyze.ts";
import { defaultWorkers, estimate, recordTiming } from "./estimate.ts";
import { DEFAULT_LEAGUE, prepareLeague, type PreparedLeague } from "./leagues.ts";
import { LAB_DIR, MODELS_DIR, REGISTRY_DIR, RUNS_DIR } from "./paths.ts";
import { runMany } from "./pool.ts";
import { DEFAULT_MODE, PRESETS, type Mode } from "./presets.ts";
import { Registry, type Entry } from "./registry.ts";
import { flagsFor, playersCsv, summaryMarkdown, verdictOf, writeJson, type Flag } from "./report.ts";
import { packPlayers, runOnce, type Job, type Script } from "./simulate.ts";
import { imputeStats } from "./statgen/model.ts";

export const LAB_VERSION = "0.2.0";

export type RunSpec = {
  mode?: Mode;
  script: string;
  baseline?: string | null;
  league?: string;
  pre?: string;
  seed?: number;
  /** Override the locked presets (advanced). */
  unlock?: { runs?: number; seasons?: number; replicates?: number };
  workers?: number;
};

export type LabEvent =
  | { type: "run"; runId: string; dir: string; estimateSeconds: number; estimateBasis: string[] }
  | { type: "stage"; stage: string; text: string }
  | { type: "progress"; stage: string; done: number; total: number; elapsed: number }
  | { type: "issue"; level: string; code: string; text: string }
  | { type: "done"; runId: string; dir: string; verdict: string; seconds: number }
  | { type: "error"; message: string };

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const calver = () => new Date().toISOString().replace(/\D/g, "").slice(0, 14);

/** Builtin scripts, registered on first use. Old CLI names keep working as aliases. */
const BUILTINS: { alias: string; file: string; family: string; role: Entry["role"]; version: string }[] = [
  { alias: "net-3.2.1", file: "net-3.2.1.js", family: "net", role: "published", version: "3.2.1" },
  { alias: "net-4.3.0", file: "net-4.3.0.js", family: "net", role: "candidate", version: "4.3.0" },
  { alias: "worker-console", file: "worker-console.js", family: "hook", role: "published", version: "1.0.0" },
];

export function registry(): Registry {
  const reg = new Registry(REGISTRY_DIR);
  for (const b of BUILTINS) reg.add(fs.readFileSync(path.join(LAB_DIR, "scripts", b.file), "utf8"), { family: b.family, role: b.role, version: b.version, source: `builtin:${b.alias}` });
  return reg;
}

/** Registry id, builtin alias, or a file (added to the registry and versioned). */
export function resolveScript(ref: string, reg = registry(), family?: string): { script: Script; entry: Entry; notes: string[] } {
  const builtin = BUILTINS.find((b) => b.alias === ref);
  let entry = builtin ? reg.list().find((e) => e.source === `builtin:${builtin.alias}`) : reg.get(ref);
  const notes: string[] = [];
  if (!entry) {
    if (!fs.existsSync(ref)) throw new Error(`Unknown script ${ref}: not a registry id, builtin or file.`);
    const added = reg.add(fs.readFileSync(ref, "utf8"), { family, source: `file:${path.basename(ref)}` });
    entry = added.entry;
    notes.push(...added.notes);
  }
  return { script: { name: entry.id, source: reg.read(entry) }, entry, notes };
}

export function presetsFor(spec: RunSpec) {
  return {
    runs: spec.unlock?.runs ?? PRESETS.quick.runs,
    seasons: spec.unlock?.seasons ?? PRESETS.deep.seasons,
    replicates: spec.unlock?.replicates ?? PRESETS.deep.replicates,
    locked: !spec.unlock,
  };
}

/** Prepare the league (validate, fix, impute) or throw with every blocking issue. */
export function ingest(leagueRef: string): PreparedLeague & { imputedRows: number } {
  const prepared = prepareLeague(leagueRef);
  if (!prepared.validation.ok) {
    const errs = prepared.validation.issues.filter((i) => i.level === "error").map((i) => `- ${i.text}`);
    throw new Error(`League ${prepared.info.name} can't be used:\n${errs.join("\n")}`);
  }
  const imputedRows = prepared.validation.imputed.length ? imputeStats(loadModel(), prepared.boundary.players, prepared.boundary.statsSeason, prepared.validation.imputed) : 0;
  return { ...prepared, imputedRows };
}

async function probe(mode: "quick" | "deep", job: Job): Promise<number> {
  const t = Date.now();
  if (mode === "quick") {
    for (let i = 0; i < 4; i++) await runOnce(job, i, 1000 + i);
    return (Date.now() - t) / 4;
  }
  await runReplicate({ ...job, seasons: 2, modelFile: path.join(MODELS_DIR, "statgen.json") }, 0, 1);
  return (Date.now() - t) / 2;
}

export async function estimateRun(spec: RunSpec): Promise<{ seconds: number; basis: string[] }> {
  const mode = spec.mode ?? DEFAULT_MODE;
  const reg = registry();
  const scripts = [spec.script, ...(spec.baseline ? [spec.baseline] : [])].map((r) => resolveScript(r, reg).script);
  const p = presetsFor(spec);
  const workers = spec.workers ?? defaultWorkers();
  let job: Job | undefined;
  const jobFor = (s: Script) => {
    if (!job) {
      const { boundary } = ingest(spec.league ?? DEFAULT_LEAGUE);
      const { players, ...meta } = boundary;
      job = { meta, playersBuf: packPlayers(players), pre: resolveScript(spec.pre ?? "worker-console", reg).script, script: s };
    }
    return { ...job, script: s };
  };
  const league = spec.league ?? DEFAULT_LEAGUE;
  const parts = scripts.flatMap((s) => [
    { mode: "quick" as const, units: p.runs, scriptSha: sha(s.source), league, s },
    ...(mode === "deep" ? [{ mode: "deep" as const, units: p.seasons * p.replicates, scriptSha: sha(s.source), league, s }] : []),
  ]);
  return estimate(parts, workers, (m, scriptSha) => probe(m, jobFor(parts.find((x) => x.scriptSha === scriptSha)!.s)));
}

export async function runLab(spec: RunSpec, emit: (e: LabEvent) => void = () => {}): Promise<{ runId: string; dir: string; verdict: string }> {
  const mode = spec.mode ?? DEFAULT_MODE;
  const seed = spec.seed ?? 69;
  const workers = spec.workers ?? defaultWorkers();
  const preset = presetsFor(spec);
  const reg = registry();
  const main = resolveScript(spec.script, reg);
  const base = spec.baseline ? resolveScript(spec.baseline, reg) : undefined;
  const pre = spec.pre === "none" ? undefined : resolveScript(spec.pre ?? "worker-console", reg);

  let runId = calver();
  for (let n = 1; fs.existsSync(path.join(RUNS_DIR, runId)); n++) runId = `${calver()}-${n}`;
  const dir = path.join(RUNS_DIR, runId);
  fs.mkdirSync(dir, { recursive: true });
  const started = Date.now();
  const status: Record<string, unknown> = { runId, state: "running", mode, script: main.entry.id, baseline: base?.entry.id ?? null, league: spec.league ?? DEFAULT_LEAGUE, startedAt: new Date().toISOString() };
  const save = () => writeJson(path.join(dir, "status.json"), status);
  const send = (e: LabEvent) => {
    if (e.type === "stage") Object.assign(status, { stage: e.stage, stageText: e.text });
    if (e.type === "progress") Object.assign(status, { progress: { stage: e.stage, done: e.done, total: e.total } });
    if (e.type !== "progress" || e.done === e.total || e.done % 25 === 0) save();
    emit(e);
  };

  try {
    const est = await estimateRun({ ...spec, mode });
    Object.assign(status, { estimateSeconds: est.seconds, estimateBasis: est.basis });
    send({ type: "run", runId, dir, estimateSeconds: est.seconds, estimateBasis: est.basis });
    send({ type: "stage", stage: "ingest", text: "Checking the league" });
    const league = ingest(spec.league ?? DEFAULT_LEAGUE);
    for (const i of league.validation.issues) send({ type: "issue", level: i.level, code: i.code, text: i.text });
    const { players, ...meta } = league.boundary;
    const job: Job = { meta, playersBuf: packPlayers(players), pre: pre?.script, script: main.script };

    const quickOf = async (s: Script, label: string): Promise<Analysis> => {
      send({ type: "stage", stage: `quick:${label}`, text: `${label}: ${preset.runs} offseasons on this league` });
      const t = Date.now();
      const results = await runMany({ ...job, script: s }, { runs: preset.runs, seed, workers, onProgress: (done) => send({ type: "progress", stage: `quick:${label}`, done, total: preset.runs, elapsed: (Date.now() - started) / 1000 }) });
      recordTiming({ mode: "quick", scriptSha: sha(s.source), league: spec.league ?? DEFAULT_LEAGUE, units: preset.runs, workers: Math.min(workers, preset.runs), ms: Date.now() - t });
      return analyze(league.boundary, results);
    };
    const deepOf = async (s: Script, label: string): Promise<DeepAnalysis> => {
      send({ type: "stage", stage: `deep:${label}`, text: `${label}: ${preset.replicates} replicates × ${preset.seasons} seasons` });
      const t = Date.now();
      const djob: DeepJob = { ...job, script: s, seasons: preset.seasons, modelFile: path.join(MODELS_DIR, "statgen.json") };
      const results = await runMany(djob, { runs: preset.replicates, seed, workers, deep: true, onProgress: (done) => send({ type: "progress", stage: `deep:${label}`, done, total: preset.replicates, elapsed: (Date.now() - started) / 1000 }) });
      recordTiming({ mode: "deep", scriptSha: sha(s.source), league: spec.league ?? DEFAULT_LEAGUE, units: preset.replicates * preset.seasons, workers: Math.min(workers, preset.replicates), ms: Date.now() - t });
      return analyzeDeep(results);
    };

    const qMain = await quickOf(main.script, main.entry.id);
    const qBase = base ? await quickOf(base.script, base.entry.id) : undefined;
    const dMain = mode === "deep" ? await deepOf(main.script, main.entry.id) : undefined;
    const dBase = mode === "deep" && base ? await deepOf(base.script, base.entry.id) : undefined;

    send({ type: "stage", stage: "report", text: "Writing the report" });
    const leagueFlags: Flag[] = league.validation.issues.filter((i) => i.level === "warn").map((i) => ({ level: "warn", text: `League: ${i.text}` }));
    const flags = [...flagsFor(qMain, qBase), ...(dMain ? deepFlags(dMain, dBase) : []), ...leagueFlags];
    const verdict = verdictOf(flags);
    const model = mode === "deep" || league.imputedRows ? loadModel() : undefined;
    const report = {
      verdict,
      flags,
      mode,
      league: { id: league.info.id, name: league.info.name, credit: league.info.credit ?? null, issues: league.validation.issues, imputedRows: league.imputedRows },
      script: { id: main.entry.id, kpis: qMain.kpis, apiCalls: qMain.apiCalls, eventTypes: qMain.eventTypes, errors: qMain.errors.slice(0, 20) },
      baseline: qBase && base ? { id: base.entry.id, kpis: qBase.kpis, apiCalls: qBase.apiCalls, errors: qBase.errors.slice(0, 20) } : null,
      deep: dMain ? { script: { seasons: dMain.seasons, ageCurve: dMain.ageCurve, failed: dMain.failed, errors: dMain.errors.slice(0, 20) }, baseline: dBase ? { seasons: dBase.seasons, ageCurve: dBase.ageCurve, failed: dBase.failed } : null } : null,
    };
    const boundaryText = `stats ${league.boundary.statsSeason} → preseason ${league.boundary.enteringSeason}`;
    let summary = summaryMarkdown({ title: `NET Lab: ${main.entry.id}`, a: qMain, base: qBase && base ? { name: base.entry.id, analysis: qBase } : undefined, scriptName: main.entry.id, boundaryText, flags });
    if (dMain) summary = summary.replace("## Biggest risers", `${deepMarkdown(dMain, main.entry.id, dBase && base ? { name: base.entry.id, analysis: dBase } : undefined)}\n## Biggest risers`);
    summary = summary.replace(`# NET Lab: ${main.entry.id}\n`, `# NET Lab: ${main.entry.id}\n\nLeague: ${league.info.name}${league.info.credit ? ` (${league.info.credit})` : ""}.${league.imputedRows ? ` ${league.validation.imputed.join(", ")} estimated for ${league.imputedRows} stat rows the export lacked.` : ""}\n`);
    const names = new Map(players.map((p) => [p.pid, `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || p.name || String(p.pid)]));

    const manifest = {
      lab_version: LAB_VERSION,
      run_id: runId,
      mode,
      created_at: new Date().toISOString(),
      spec: { ...spec, mode, seed, script: main.entry.id, baseline: base?.entry.id ?? null, pre: pre?.entry.id ?? "none", league: league.info.id },
      presets: { ...preset, why: { quick: PRESETS.quick.why, deep: PRESETS.deep.why } },
      script: { id: main.entry.id, sha256: main.entry.sha256 },
      baseline: base ? { id: base.entry.id, sha256: base.entry.sha256 } : null,
      pre: pre ? { id: pre.entry.id, sha256: pre.entry.sha256 } : null,
      league: { id: league.info.id, name: league.info.name, url: league.info.url ?? null, sha256: league.boundary.exportSha256, fixes: league.validation.issues.filter((i) => i.level === "fix").map((i) => i.code), imputed: league.validation.imputed },
      input: { source_season: meta.sourceSeason, source_phase: meta.sourcePhase, stats_season: meta.statsSeason, entering_season: meta.enteringSeason, base_develop: meta.baseDevelop },
      statgen: model ? { version: model.version, trainedOn: model.trainedOn, calibration: model.calibration ?? null } : null,
      bbgm_compat: COMPAT_TARGET,
      rng: "sfc32 seeded per offseason/replicate via splitmix32(seed, run); replaces Math.random. Deep mode draws stats from a separate stream.",
      runtime: { node: process.version, platform: `${os.platform()}-${os.arch()}`, cpus: os.availableParallelism(), workers },
      report_sha256: sha(JSON.stringify(report)),
    };
    writeJson(path.join(dir, "manifest.json"), manifest);
    writeJson(path.join(dir, "report.json"), report);
    fs.writeFileSync(path.join(dir, "players.csv"), playersCsv(qMain.players));
    if (qBase) fs.writeFileSync(path.join(dir, "players.baseline.csv"), playersCsv(qBase.players));
    if (dMain) {
      const top = (d: DeepAnalysis) => d.trajectories.map((t) => ({ ...t, name: names.get(t.pid) ?? String(t.pid) }));
      writeJson(path.join(dir, "deep.json"), { script: { ...dMain, trajectories: top(dMain) }, baseline: dBase ? { ...dBase, trajectories: top(dBase) } : null });
    }
    fs.writeFileSync(path.join(dir, "summary.md"), summary);
    const seconds = Math.round((Date.now() - started) / 1000);
    Object.assign(status, { state: "done", verdict, finishedAt: new Date().toISOString(), seconds });
    save();
    send({ type: "done", runId, dir, verdict, seconds });
    return { runId, dir, verdict };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    Object.assign(status, { state: "failed", error: message, finishedAt: new Date().toISOString() });
    save();
    send({ type: "error", message });
    throw err;
  }
}

/** Re-run a manifest's spec and confirm the report is byte-identical. */
export async function replay(manifestPath: string, emit?: (e: LabEvent) => void): Promise<{ same: boolean; dir: string }> {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const { workers: _w, ...spec } = manifest.spec;
  const { dir } = await runLab(spec, emit);
  const again = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  return { same: again.report_sha256 === manifest.report_sha256 && again.league.sha256 === manifest.league.sha256 && again.script.sha256 === manifest.script.sha256, dir };
}

export function listRuns(): Record<string, unknown>[] {
  if (!fs.existsSync(RUNS_DIR)) return [];
  return fs
    .readdirSync(RUNS_DIR)
    .filter((d) => fs.existsSync(path.join(RUNS_DIR, d, "status.json")))
    .sort()
    .reverse()
    .map((d) => JSON.parse(fs.readFileSync(path.join(RUNS_DIR, d, "status.json"), "utf8")));
}
