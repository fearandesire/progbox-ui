import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { analyze, productionEffect, type Analysis } from "./analyze.ts";
import { COMPAT_TARGET } from "./compat.ts";
import { loadModel, runReplicate, type DeepJob } from "./deep.ts";
import { analyzeDeep, deepFlags, deepMarkdown, type DeepAnalysis, type DeepSeason } from "./deepAnalyze.ts";
import { defaultWorkers, estimate, recordTiming } from "./estimate.ts";
import { ovrOf } from "./league.ts";
import { DEFAULT_LEAGUE, leagueSha256, prepareLeague, type PreparedLeague } from "./leagues.ts";
import { LAB_DIR, MODELS_DIR, REFERENCE_DIR, REGISTRY_DIR, RUNS_DIR, TRASH_DIR } from "./paths.ts";
import { runMany } from "./pool.ts";
import { DEFAULT_MODE, PRESETS, seasonsOf, type Mode } from "./presets.ts";
import { Registry, type Entry } from "./registry.ts";
import { flagsFor, playersCsv, summaryMarkdown, verdictOf, writeJson, type Flag } from "./report.ts";
import type { Player } from "./shim.ts";
import { packPlayers, runOnce, type Job, type Script } from "./simulate.ts";
import { imputeStats } from "./statgen/model.ts";
import { checksMarkdown, gradeChecks, verdictText, type CheckInput, type Checks, type SideInput } from "./verdict.ts";
import { LAB_VERSION, labMeta, type LabMeta } from "./version.ts";

export { LAB_VERSION };

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
  /** Skip the cached no-script reference run (the "No script" column stays empty). */
  noReference?: boolean;
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
export const BUILTINS: { alias: string; file: string; family: string; role: Entry["role"]; version: string }[] = [
  { alias: "net-3.2.1", file: "net-3.2.1.js", family: "net", role: "published", version: "3.2.1" },
  { alias: "net-4.3.0", file: "net-4.3.0.js", family: "net", role: "candidate", version: "4.3.0" },
  { alias: "worker-console", file: "worker-console.js", family: "hook", role: "published", version: "1.0.0" },
];

/** The registry with builtins in place; trash older than 7 days is purged here, lazily. */
export function registry(): Registry {
  const reg = new Registry(REGISTRY_DIR, { trashDir: TRASH_DIR, runsDir: RUNS_DIR });
  for (const b of BUILTINS) reg.add(fs.readFileSync(path.join(LAB_DIR, "scripts", b.file), "utf8"), { family: b.family, role: b.role, version: b.version, source: `builtin:${b.alias}` });
  reg.purge();
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

/* ---------- No-script reference ---------- */

/** The same league with the pre-progs hook and BBGM-style development only. */
const NO_SCRIPT: Script = { name: "no-script", source: "" };
export const REFERENCE_REPLICATES = 60;
const REFERENCE_SEED = 69;

export type Reference = {
  key: string;
  createdAt: string;
  lab: string;
  statgen: string | null;
  league: string;
  mode: Mode;
  seasons: number;
  replicates: number;
  seed: number;
  failed: number;
  deep: { seasons: DeepSeason[]; ageCurve: Record<string, number>; ageCurveSe: Record<string, number> };
};

function referenceSpec(o: { leagueSha: string; mode: Mode; seasons: number; replicates: number; statgen: string | null; preSha: string | null }) {
  const replicates = Math.min(REFERENCE_REPLICATES, o.replicates);
  const key = sha(JSON.stringify({ league: o.leagueSha, lab: LAB_VERSION, statgen: o.statgen, mode: o.mode, seasons: o.seasons, replicates, seed: REFERENCE_SEED, pre: o.preSha })).slice(0, 24);
  return { key, replicates, file: path.join(REFERENCE_DIR, `${key}.json`) };
}

function readReference(file: string): Reference | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Reference;
  } catch {
    return null;
  }
}

/* ---------- Estimates ---------- */

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
  const seasons = seasonsOf(mode, p.seasons);
  const workers = spec.workers ?? defaultWorkers();
  const league = spec.league ?? DEFAULT_LEAGUE;
  const pre = spec.pre === "none" ? undefined : resolveScript(spec.pre ?? "worker-console", reg).script;
  let job: Job | undefined;
  const jobFor = (s: Script) => {
    if (!job) {
      const { boundary } = ingest(league);
      const { players, ...meta } = boundary;
      job = { meta, playersBuf: packPlayers(players), pre, script: s };
    }
    return { ...job, script: s };
  };
  const parts = scripts.flatMap((s) => [
    { mode: "quick" as const, units: p.runs, scriptSha: sha(s.source), league, s },
    ...(seasons ? [{ mode: "deep" as const, units: seasons * p.replicates, scriptSha: sha(s.source), league, s }] : []),
  ]);
  const leagueSha = seasons && !spec.noReference ? leagueSha256(league) : null;
  if (leagueSha) {
    const ref = referenceSpec({ leagueSha, mode, seasons, replicates: p.replicates, statgen: loadModel().version, preSha: pre ? sha(pre.source) : null });
    if (!fs.existsSync(ref.file)) parts.push({ mode: "deep", units: seasons * ref.replicates, scriptSha: sha(NO_SCRIPT.source), league, s: NO_SCRIPT });
  }
  return estimate(parts, workers, (m, scriptSha) => probe(m, jobFor(parts.find((x) => x.scriptSha === scriptSha)!.s)));
}

/* ---------- Run details and checks ---------- */

/** "2025-26" for BBGM season 2026. */
export const seasonLabel = (y: number) => `${y - 1}-${String(y % 100).padStart(2, "0")}`;

export type RunDetails = {
  mode: Mode;
  netRuns: string;
  gamesSimulated: boolean;
  statsRead: string;
  league: { id: string; name: string };
  runs: number;
  seasons: number | null;
  seed: number;
  scripts: { id: string; sha256: string }[];
  pre: { id: string; sha256: string } | null;
};

export function runDetailsFor(o: {
  mode: Mode;
  seasons: number;
  boundary: { statsSeason: number; enteringSeason: number; baseDevelop: string };
  league: { id: string; name: string };
  preset: { runs: number; replicates: number };
  seed: number;
  scripts: Entry[];
  pre: Entry | null;
}): RunDetails {
  const { statsSeason, enteringSeason, baseDevelop } = o.boundary;
  // "After one season" plays the season in progress: the entering one for a preseason file, else the file's own.
  const played = baseDevelop === "export" ? enteringSeason : statsSeason;
  const netRuns = o.mode === "deep" ? `Every offseason, ${o.seasons} seasons` : o.mode === "season" ? `Once, after the ${seasonLabel(played)} season` : "Once, right now";
  const later = o.seasons - 1;
  const statsRead =
    o.mode === "season" ? `${seasonLabel(played)} simulated` : o.mode === "deep" && later > 0 ? `${seasonLabel(statsSeason)} real, then ${later} simulated season${later === 1 ? "" : "s"}` : `${seasonLabel(statsSeason)} real`;
  return {
    mode: o.mode,
    netRuns,
    gamesSimulated: o.mode !== "quick",
    statsRead,
    league: o.league,
    runs: o.mode === "quick" ? o.preset.runs : o.preset.replicates,
    seasons: o.mode === "quick" ? null : o.seasons,
    seed: o.seed,
    scripts: o.scripts.map((e) => ({ id: e.id, sha256: e.sha256 })),
    pre: o.pre ? { id: o.pre.id, sha256: o.pre.sha256 } : null,
  };
}

/** League state before the first offseason: active players' current OVR. */
export function leagueStart(players: Player[]): { leagueMeanOvr: number; count75: number; count80: number } {
  const ovrs = players.filter((p) => Number.isInteger(p.tid) && p.tid >= 0 && p.ratings.length).map((p) => ovrOf(p.ratings.at(-1)!));
  return { leagueMeanOvr: ovrs.reduce((a, b) => a + b, 0) / Math.max(1, ovrs.length), count75: ovrs.filter((v) => v >= 75).length, count80: ovrs.filter((v) => v >= 80).length };
}

type ReportLike = Record<string, any>;
const sideOf = (kpis: any, deep: any): SideInput => ({
  quick: kpis ? { runs: kpis.runs, godProgsPerRun: kpis.godProgsPerRun, godProgsSe: kpis.godProgsSe, medianPlayerSd: kpis.medianPlayerSd, perEffect: kpis.perEffect, perEffectSe: kpis.perEffectSe, deltaByAge: kpis.deltaByAge ?? {} } : null,
  deep: deep?.seasons?.length ? { seasons: deep.seasons, ageCurve: deep.ageCurve ?? {}, ageCurveSe: deep.ageCurveSe } : null,
});

/** Check inputs from a report.json (the run's own, or an old one being regraded). */
export function checkInputOf(report: ReportLike, start: CheckInput["start"] = report.deep?.start ?? null): CheckInput {
  const deep = report.deep;
  const seasons = report.runDetails?.seasons ?? deep?.script?.seasons?.length ?? 0;
  return {
    start,
    seasons: report.mode === "quick" ? 0 : seasons,
    script: sideOf(report.script?.kpis, deep?.script),
    baseline: report.baseline ? sideOf(report.baseline.kpis, deep?.baseline) : null,
    noScript: deep?.noScript ? sideOf(null, deep.noScript) : null,
  };
}

function runDetailsMarkdown(d: RunDetails, lab: LabMeta): string {
  const rows: [string, string][] = [
    ["NET runs", d.netRuns],
    ["Games", d.gamesSimulated ? "Simulated (StatGen, fit to BBGM output)" : "None; NET reads the stats in the file"],
    ["Stats NET read", d.statsRead],
    ["League", d.league.name],
    ["Runs", `${d.runs}, seed ${d.seed}`],
    ["Scripts", [...d.scripts.map((s) => `${s.id} ${s.sha256.slice(0, 8)}`), ...(d.pre ? [d.pre.id] : [])].join(", ")],
    ["NET Lab", `${lab.version}${lab.commit ? `, commit ${lab.commit}` : ""}`],
    ["Checks", `checks v${lab.checks.version}, rules ${lab.checks.rulesSha256.slice(0, 8)}`],
    ["StatGen", lab.statgen ?? "not used"],
  ];
  return ["## Run details", "", "| | |", "|---|---|", ...rows.map(([k, v]) => `| ${k} | ${v} |`), ""].join("\n");
}

/* ---------- Runs ---------- */

export async function runLab(spec: RunSpec, emit: (e: LabEvent) => void = () => {}): Promise<{ runId: string; dir: string; verdict: string }> {
  const mode = spec.mode ?? DEFAULT_MODE;
  const seed = spec.seed ?? 69;
  const workers = spec.workers ?? defaultWorkers();
  const preset = presetsFor(spec);
  const seasons = seasonsOf(mode, preset.seasons);
  const reg = registry();
  const main = resolveScript(spec.script, reg);
  const base = spec.baseline ? resolveScript(spec.baseline, reg) : undefined;
  const pre = spec.pre === "none" ? undefined : resolveScript(spec.pre ?? "worker-console", reg);
  const modelFile = path.join(MODELS_DIR, "statgen.json");
  const statgenVersion = fs.existsSync(modelFile) ? loadModel(modelFile).version : null;
  const lab = labMeta(seasons ? statgenVersion : null);

  let runId = calver();
  for (let n = 1; fs.existsSync(path.join(RUNS_DIR, runId)); n++) runId = `${calver()}-${n}`;
  const dir = path.join(RUNS_DIR, runId);
  fs.mkdirSync(dir, { recursive: true });
  const started = Date.now();
  const status: Record<string, unknown> = {
    runId,
    state: "running",
    mode,
    script: main.entry.id,
    baseline: base?.entry.id ?? null,
    league: spec.league ?? DEFAULT_LEAGUE,
    startedAt: new Date().toISOString(),
    lab: { version: lab.version, checksVersion: lab.checks.version },
  };
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
    for (const r of [main, base]) for (const text of r?.notes.filter((n) => n.startsWith("Version forced up")) ?? []) send({ type: "issue", level: "fix", code: "version-bumped", text });
    send({ type: "stage", stage: "ingest", text: "Checking the league" });
    const league = ingest(spec.league ?? DEFAULT_LEAGUE);
    for (const i of league.validation.issues) send({ type: "issue", level: i.level, code: i.code, text: i.text });
    const { players, ...meta } = league.boundary;
    const job: Job = { meta, playersBuf: packPlayers(players), pre: pre?.script, script: main.script };
    const progress = (stage: string, total: number) => (done: number) => send({ type: "progress", stage, done, total, elapsed: (Date.now() - started) / 1000 });

    const quickOf = async (s: Script, label: string): Promise<Analysis> => {
      send({ type: "stage", stage: `quick:${label}`, text: `${label}: ${preset.runs} offseasons on this league` });
      const t = Date.now();
      const results = await runMany({ ...job, script: s }, { runs: preset.runs, seed, workers, onProgress: progress(`quick:${label}`, preset.runs) });
      recordTiming({ mode: "quick", scriptSha: sha(s.source), league: spec.league ?? DEFAULT_LEAGUE, units: preset.runs, workers: Math.min(workers, preset.runs), ms: Date.now() - t });
      return analyze(league.boundary, results);
    };
    const deepOf = async (s: Script, replicates: number, runSeed: number, stage: string, text: string): Promise<DeepAnalysis> => {
      send({ type: "stage", stage, text });
      const t = Date.now();
      const djob: DeepJob = { ...job, script: s, seasons, modelFile, playFirst: mode === "season" };
      const results = await runMany(djob, { runs: replicates, seed: runSeed, workers, deep: true, onProgress: progress(stage, replicates) });
      recordTiming({ mode: "deep", scriptSha: sha(s.source), league: spec.league ?? DEFAULT_LEAGUE, units: replicates * seasons, workers: Math.min(workers, replicates), ms: Date.now() - t });
      return analyzeDeep(results);
    };
    const deepText = (label: string) => (mode === "season" ? `${label}: ${preset.replicates} replicates, one simulated season then NET once` : `${label}: ${preset.replicates} replicates × ${seasons} seasons`);

    const qMain = await quickOf(main.script, main.entry.id);
    const qBase = base ? await quickOf(base.script, base.entry.id) : undefined;
    const dMain = seasons ? await deepOf(main.script, preset.replicates, seed, `deep:${main.entry.id}`, deepText(main.entry.id)) : undefined;
    const dBase = seasons && base ? await deepOf(base.script, preset.replicates, seed, `deep:${base.entry.id}`, deepText(base.entry.id)) : undefined;

    let reference: (Reference & { cached: boolean }) | null = null;
    if (seasons && !spec.noReference) {
      const ref = referenceSpec({ leagueSha: league.boundary.exportSha256, mode, seasons, replicates: preset.replicates, statgen: statgenVersion, preSha: pre ? pre.entry.sha256 : null });
      const cached = readReference(ref.file);
      if (cached) reference = { ...cached, cached: true };
      else {
        const d = await deepOf(NO_SCRIPT, ref.replicates, REFERENCE_SEED, "reference", `No-script reference: ${ref.replicates} replicates × ${seasons} season${seasons === 1 ? "" : "s"} (cached for later runs)`);
        const made: Reference = { key: ref.key, createdAt: new Date().toISOString(), lab: LAB_VERSION, statgen: statgenVersion, league: league.boundary.exportSha256, mode, seasons, replicates: ref.replicates, seed: REFERENCE_SEED, failed: d.failed, deep: { seasons: d.seasons, ageCurve: d.ageCurve, ageCurveSe: d.ageCurveSe } };
        writeJson(ref.file, made);
        reference = { ...made, cached: false };
      }
    }

    send({ type: "stage", stage: "report", text: "Writing the report" });
    const leagueFlags: Flag[] = league.validation.issues.filter((i) => i.level === "warn").map((i) => ({ level: "warn", text: `League: ${i.text}` }));
    const flags = [...flagsFor(qMain, qBase), ...(dMain ? deepFlags(dMain, dBase) : []), ...leagueFlags];
    const verdict = verdictOf(flags);
    const model = seasons || league.imputedRows ? loadModel() : undefined;
    const runDetails = runDetailsFor({ mode, seasons, boundary: league.boundary, league: { id: league.info.id, name: league.info.name }, preset, seed, scripts: [main.entry, ...(base ? [base.entry] : [])], pre: pre?.entry ?? null });
    const deepPart = (d: DeepAnalysis) => ({ seasons: d.seasons, ageCurve: d.ageCurve, ageCurveSe: d.ageCurveSe, failed: d.failed });
    const report: ReportLike = {
      verdict,
      flags,
      mode,
      lab,
      runDetails,
      checks: null as Checks | null,
      league: { id: league.info.id, name: league.info.name, credit: league.info.credit ?? null, issues: league.validation.issues, imputedRows: league.imputedRows },
      script: { id: main.entry.id, kpis: qMain.kpis, apiCalls: qMain.apiCalls, eventTypes: qMain.eventTypes, errors: qMain.errors.slice(0, 20) },
      baseline: qBase && base ? { id: base.entry.id, kpis: qBase.kpis, apiCalls: qBase.apiCalls, errors: qBase.errors.slice(0, 20) } : null,
      deep: dMain
        ? {
            start: leagueStart(players),
            script: { ...deepPart(dMain), errors: dMain.errors.slice(0, 20) },
            baseline: dBase ? deepPart(dBase) : null,
            noScript: reference ? { ...reference.deep, replicates: reference.replicates, key: reference.key } : null,
          }
        : null,
    };
    const checks = gradeChecks(checkInputOf(report));
    report.checks = checks;

    const boundaryText = `stats ${league.boundary.statsSeason} → preseason ${league.boundary.enteringSeason}`;
    let summary = summaryMarkdown({ title: `NET Lab: ${main.entry.id}`, a: qMain, base: qBase && base ? { name: base.entry.id, analysis: qBase } : undefined, scriptName: main.entry.id, boundaryText, flags });
    if (dMain) summary = summary.replace("## Biggest risers", `${deepMarkdown(dMain, main.entry.id, dBase && base ? { name: base.entry.id, analysis: dBase } : undefined)}\n## Biggest risers`);
    const top = [
      `# NET Lab: ${main.entry.id}${base ? ` vs ${base.entry.id}` : ""}`,
      "",
      `NET Lab ${lab.version}${lab.commit ? ` (commit ${lab.commit})` : ""} · checks v${lab.checks.version} (rules ${lab.checks.rulesSha256.slice(0, 8)}) · StatGen ${lab.statgen ?? "not used"}`,
      "",
      checksMarkdown(checks, main.entry.id, base?.entry.id ?? null),
      runDetailsMarkdown(runDetails, lab),
      `League: ${league.info.name}${league.info.credit ? ` (${league.info.credit})` : ""}.${league.imputedRows ? ` ${league.validation.imputed.join(", ")} estimated for ${league.imputedRows} stat rows the export lacked.` : ""}${reference ? ` No script: ${reference.replicates} replicates${reference.cached ? ", cached" : ""}.` : ""}`,
      "",
      "## First offseason, many seeds",
      "",
      "",
    ].join("\n");
    summary = summary.replace(`# NET Lab: ${main.entry.id}\n\n`, top);
    const names = new Map(players.map((p) => [p.pid, `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || p.name || String(p.pid)]));

    const manifest = {
      lab_version: LAB_VERSION,
      lab,
      run_id: runId,
      mode,
      created_at: new Date().toISOString(),
      spec: { ...spec, mode, seed, script: main.entry.id, baseline: base?.entry.id ?? null, pre: pre?.entry.id ?? "none", league: league.info.id },
      presets: { ...preset, seasons, why: { quick: PRESETS.quick.why, deep: PRESETS.deep.why } },
      script: { id: main.entry.id, sha256: main.entry.sha256, declared: main.entry.declared, bumped: main.entry.bumped ?? null },
      baseline: base ? { id: base.entry.id, sha256: base.entry.sha256, declared: base.entry.declared, bumped: base.entry.bumped ?? null } : null,
      pre: pre ? { id: pre.entry.id, sha256: pre.entry.sha256 } : null,
      league: { id: league.info.id, name: league.info.name, url: league.info.url ?? null, sha256: league.boundary.exportSha256, fixes: league.validation.issues.filter((i) => i.level === "fix").map((i) => i.code), imputed: league.validation.imputed },
      input: { source_season: meta.sourceSeason, source_phase: meta.sourcePhase, stats_season: meta.statsSeason, entering_season: meta.enteringSeason, base_develop: meta.baseDevelop },
      statgen: model ? { version: model.version, trainedOn: model.trainedOn, calibration: model.calibration ?? null } : null,
      reference: reference ? { key: reference.key, replicates: reference.replicates, seed: reference.seed, cached: reference.cached, createdAt: reference.createdAt } : null,
      bbgm_compat: COMPAT_TARGET,
      rng: "sfc32 seeded per offseason/replicate via splitmix32(seed, run); replaces Math.random. Deep mode draws stats from a separate stream.",
      runtime: { node: process.version, platform: `${os.platform()}-${os.arch()}`, cpus: os.availableParallelism(), workers },
      // The Lab's own metadata (commit) is left out so a replay on another checkout can still match.
      report_sha256: sha(JSON.stringify({ ...report, lab: undefined })),
    };
    writeJson(path.join(dir, "manifest.json"), manifest);
    writeJson(path.join(dir, "report.json"), report);
    fs.writeFileSync(path.join(dir, "players.csv"), playersCsv(qMain.players));
    if (qBase) fs.writeFileSync(path.join(dir, "players.baseline.csv"), playersCsv(qBase.players));
    if (dMain) {
      const traj = (d: DeepAnalysis) => d.trajectories.map((t) => ({ ...t, name: names.get(t.pid) ?? String(t.pid) }));
      writeJson(path.join(dir, "deep.json"), { script: { ...dMain, trajectories: traj(dMain) }, baseline: dBase ? { ...dBase, trajectories: traj(dBase) } : null });
    }
    fs.writeFileSync(path.join(dir, "summary.md"), summary);
    const seconds = Math.round((Date.now() - started) / 1000);
    Object.assign(status, { state: "done", verdict, checks: { verdict: checks.verdict, script: checks.script, baseline: checks.baseline }, finishedAt: new Date().toISOString(), seconds });
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

/* ---------- Regrade ---------- */

export type Regrade = {
  runId: string;
  at: string;
  lab: LabMeta;
  start: { source: "report" | "league" | "first-season"; value: CheckInput["start"] };
  before: { verdict: string | null; flagsVerdict: string | null; checksVersion: number | null; rulesSha256: string | null; labVersion: string | null; checks: Checks | null };
  after: Checks;
  changed: { id: string; before: boolean | null; after: boolean | null }[];
};

/** Minimal CSV reader for players.csv (quoted names may hold commas). */
function readCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  for (const line of text.split("\n").filter(Boolean)) {
    const cells: string[] = [];
    let cur = "";
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i]!;
      if (q) {
        if (c === '"' && line[i + 1] === '"') (cur += '"'), i++;
        else if (c === '"') q = false;
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ",") cells.push(cur), (cur = "");
      else cur += c;
    }
    cells.push(cur);
    rows.push(cells);
  }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head!.map((h, i) => [h, r[i] ?? ""])));
}

function perEffectSeFromCsv(file: string): number | null {
  if (!fs.existsSync(file)) return null;
  const n = (v: string | undefined) => (v === undefined || v === "" || v === "null" ? null : Number(v));
  const rows = readCsv(fs.readFileSync(file, "utf8")).map((r) => ({ age: n(r.age)!, baseOvr: n(r.baseOvr)!, meanDelta: n(r.meanDelta)!, sdDelta: n(r.sdDelta) ?? 0, runs: n(r.runs) ?? 1, per: n(r.per) }));
  return productionEffect(rows, "per")?.se ?? null;
}

/** Recompute a saved run's checks with today's rules. Reads report.json (and players CSVs); never re-simulates. */
export function regrade(runId: string): Regrade {
  if (!/^[\w.-]+$/.test(runId)) throw new Error(`Invalid run id ${runId}`);
  const dir = path.join(RUNS_DIR, runId);
  const reportFile = path.join(dir, "report.json");
  if (!fs.existsSync(reportFile)) throw new Error(`Run ${runId} has no report.json (is it finished?)`);
  const report = JSON.parse(fs.readFileSync(reportFile, "utf8")) as ReportLike;
  const manifest = fs.existsSync(path.join(dir, "manifest.json")) ? JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")) : {};
  // Older runs lack the Monte Carlo SE of the PER effect; players.csv has what it needs.
  for (const [side, csv] of [["script", "players.csv"], ["baseline", "players.baseline.csv"]] as const) {
    const kpis = report[side]?.kpis;
    if (kpis && kpis.perEffectSe === undefined) kpis.perEffectSe = perEffectSeFromCsv(path.join(dir, csv));
  }
  let start: Regrade["start"] = { source: "report", value: report.deep?.start ?? null };
  if (!start.value && report.deep) {
    try {
      const league = prepareLeague(manifest.league?.id ?? report.league?.id);
      if (league.validation.ok && league.boundary.exportSha256 === manifest.league?.sha256) start = { source: "league", value: leagueStart(league.boundary.players) };
    } catch {
      /* league gone; fall back below */
    }
    const first = report.deep.script?.seasons?.[0];
    if (!start.value && first) start = { source: "first-season", value: { leagueMeanOvr: first.leagueMeanOvr.mean, count75: first.count75.mean, count80: first.count80.mean } };
  }
  const after = gradeChecks(checkInputOf(report, start.value));
  const old: Checks | null = report.checks ?? null;
  const passOf = (c: Checks | null, id: string) => c?.items.find((i) => i.id === id)?.script?.pass ?? null;
  const out: Regrade = {
    runId,
    at: new Date().toISOString(),
    lab: labMeta(report.lab?.statgen ?? manifest.statgen?.version ?? null),
    start,
    before: { verdict: old?.verdict ?? null, flagsVerdict: report.verdict ?? null, checksVersion: old?.version ?? null, rulesSha256: old?.rulesSha256 ?? null, labVersion: report.lab?.version ?? manifest.lab_version ?? null, checks: old },
    after,
    changed: after.items.filter((i) => passOf(old, i.id) !== (i.script?.pass ?? null)).map((i) => ({ id: i.id, before: passOf(old, i.id), after: i.script?.pass ?? null })),
  };
  writeJson(path.join(dir, "regrade.json"), out);
  return out;
}

/** Side-by-side text for `pnpm lab regrade`. */
export function regradeText(r: Regrade, scriptId: string, baselineId: string | null): string {
  const b = r.before;
  const left = b.checks ? `checks v${b.checksVersion} (${b.rulesSha256?.slice(0, 8)})` : `no checks (NET Lab ${b.labVersion ?? "?"})`;
  const right = `checks v${r.after.version} (${r.after.rulesSha256.slice(0, 8)})`;
  const w = 34;
  const pad = (s: string) => s.padEnd(w);
  const v = (c: Checks | null) => (c ? verdictText(c, scriptId, baselineId).title : `flags: ${b.flagsVerdict ?? "n/a"}`);
  const mark = (x: { display: string; pass: boolean | null } | null | undefined) => (x ? `${x.pass ? "pass" : "fail"} ${x.display}` : "n/a");
  const lines = [`Regrade ${r.runId}: ${scriptId}${baselineId ? ` vs ${baselineId}` : ""}`, "", `${pad("")}${pad(`Before: ${left}`)}Now: ${right}`, `${pad("Verdict")}${pad(v(b.checks))}${v(r.after)}`];
  for (const i of r.after.items) {
    const was = b.checks?.items.find((x) => x.id === i.id);
    lines.push(`${pad(i.name)}${pad(was ? mark(was.applicable ? was.script : null) : "n/a")}${i.applicable ? mark(i.script) : "n/a (needs 10 seasons)"}`);
  }
  if (r.start.source === "first-season") lines.push("", "Start values came from the first season of the run (the league file is gone or changed).");
  lines.push("", `Wrote ${path.join(RUNS_DIR, r.runId, "regrade.json")}`);
  return lines.join("\n");
}

export function listRuns(): Record<string, unknown>[] {
  if (!fs.existsSync(RUNS_DIR)) return [];
  return fs
    .readdirSync(RUNS_DIR)
    .filter((d) => fs.existsSync(path.join(RUNS_DIR, d, "status.json")))
    .sort()
    .reverse()
    .map((d) => {
      const status = JSON.parse(fs.readFileSync(path.join(RUNS_DIR, d, "status.json"), "utf8")) as Record<string, unknown>;
      if (!status.lab) {
        try {
          const m = JSON.parse(fs.readFileSync(path.join(RUNS_DIR, d, "manifest.json"), "utf8"));
          status.lab = { version: m.lab?.version ?? m.lab_version ?? null, checksVersion: m.lab?.checks?.version ?? null };
        } catch {
          status.lab = null;
        }
      }
      return status;
    });
}
