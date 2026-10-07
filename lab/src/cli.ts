import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { analyze, type Analysis } from "./analyze.ts";
import { readSources } from "./bbgmHelpers.ts";
import { boundaryFrom, readExport, type Boundary } from "./league.ts";
import { runMany } from "./pool.ts";
import { flagsFor, playersCsv, summaryMarkdown, verdictOf, writeJson } from "./report.ts";
import { packPlayers, type Job, type Script } from "./simulate.ts";

const LAB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_DIR = path.resolve(LAB_DIR, "..");
/** pnpm runs package scripts from lab/; INIT_CWD is where the user actually typed the command. */
const CALLER_DIR = process.env.INIT_CWD || process.cwd();
const BUILTIN = ["net-3.2.1", "net-4.3.0", "worker-console"];
export const LAB_VERSION = "0.1.0";

const USAGE = `NET Lab

  pnpm lab quick --script <file|builtin> [--baseline <file|builtin>] [options]
  pnpm lab replay <manifest.json>

Builtins: ${BUILTIN.join(", ")}

Options:
  --export <file>     League export (default: data/export.json)
  --pre <file|none>   Pre-progs hook (default: worker-console)
  --runs <n>          Offseasons to simulate (default: 500)
  --seed <n>          Base seed (default: 69)
  --workers <n>       Worker threads (default: cores - 1)
  --out <dir>         Output root (default: outputs/lab)
`;

function resolveScript(ref: string): Script {
  const file = BUILTIN.includes(ref) ? path.join(LAB_DIR, "scripts", `${ref}.js`) : path.resolve(CALLER_DIR, ref);
  if (!fs.existsSync(file)) throw new Error(`script not found: ${ref}`);
  return { name: BUILTIN.includes(ref) ? ref : path.basename(file), source: fs.readFileSync(file, "utf8") };
}

/** Builtins stay as names; files are stored as absolute paths so a replay finds them from any directory. */
const refFor = (ref: string) => (BUILTIN.includes(ref) ? ref : path.resolve(CALLER_DIR, ref));
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const calver = () => new Date().toISOString().replace(/\D/g, "").slice(0, 14);

type QuickArgs = { script: string; baseline?: string; export: string; pre: string; runs: number; seed: number; workers?: number; out: string };

async function simulate(boundary: Boundary, script: Script, pre: Script | undefined, a: QuickArgs, label: string): Promise<Analysis> {
  const { players, ...meta } = boundary;
  const job: Job = { meta, playersBuf: packPlayers(players), pre, script };
  const started = Date.now();
  let last = 0;
  const results = await runMany(job, {
    runs: a.runs,
    seed: a.seed,
    workers: a.workers,
    onProgress: (done) => {
      const now = Date.now();
      if (done === a.runs || now - last > 2000) {
        last = now;
        process.stderr.write(`  ${label}: ${done}/${a.runs} offseasons (${((now - started) / 1000).toFixed(0)}s)\n`);
      }
    },
  });
  return analyze(boundary, results);
}

export async function quick(a: QuickArgs): Promise<{ dir: string; verdict: string }> {
  const exportFile = readExport(path.resolve(CALLER_DIR, a.export));
  const boundary = boundaryFrom(exportFile);
  const script = resolveScript(a.script);
  const baseline = a.baseline ? resolveScript(a.baseline) : undefined;
  const pre = a.pre === "none" ? undefined : resolveScript(a.pre);
  const boundaryText = `stats ${boundary.statsSeason} → preseason ${boundary.enteringSeason}`;
  process.stderr.write(`NET Lab quick: ${script.name}${baseline ? ` vs ${baseline.name}` : ""}, ${a.runs} offseasons, ${boundaryText}\n`);

  const main = await simulate(boundary, script, pre, a, script.name);
  const base = baseline ? await simulate(boundary, baseline, pre, a, baseline.name) : undefined;
  const flags = flagsFor(main, base);
  let dir = path.resolve(CALLER_DIR, a.out, calver());
  for (let n = 1; fs.existsSync(dir); n++) dir = path.resolve(CALLER_DIR, a.out, `${calver()}-${n}`);
  const report = {
    verdict: verdictOf(flags),
    flags,
    script: { name: script.name, kpis: main.kpis, apiCalls: main.apiCalls, eventTypes: main.eventTypes, errors: main.errors.slice(0, 20) },
    baseline: base && baseline ? { name: baseline.name, kpis: base.kpis, apiCalls: base.apiCalls, errors: base.errors.slice(0, 20) } : null,
  };
  const manifest = {
    lab_version: LAB_VERSION,
    mode: "quick",
    created_at: new Date().toISOString(),
    args: { ...a, export: path.resolve(CALLER_DIR, a.export), out: path.resolve(CALLER_DIR, a.out), script: refFor(a.script), baseline: a.baseline && refFor(a.baseline), pre: a.pre === "none" ? "none" : refFor(a.pre) },
    script: { name: script.name, sha256: sha(script.source) },
    baseline: baseline ? { name: baseline.name, sha256: sha(baseline.source) } : null,
    pre: pre ? { name: pre.name, sha256: sha(pre.source) } : null,
    input: {
      export_sha256: boundary.exportSha256,
      source_season: boundary.sourceSeason,
      source_phase: boundary.sourcePhase,
      stats_season: boundary.statsSeason,
      entering_season: boundary.enteringSeason,
      base_develop: boundary.baseDevelop,
    },
    bbgm_helpers_revision: readSources().revision,
    rng: "sfc32 seeded per offseason via splitmix32(seed, run); replaces Math.random",
    runtime: { node: process.version, platform: `${os.platform()}-${os.arch()}` },
    report_sha256: sha(JSON.stringify(report)),
  };
  fs.mkdirSync(dir, { recursive: true });
  writeJson(path.join(dir, "manifest.json"), manifest);
  writeJson(path.join(dir, "report.json"), report);
  fs.writeFileSync(path.join(dir, "players.csv"), playersCsv(main.players));
  if (base) fs.writeFileSync(path.join(dir, "players.baseline.csv"), playersCsv(base.players));
  fs.writeFileSync(
    path.join(dir, "summary.md"),
    summaryMarkdown({ title: `NET Lab: ${script.name}`, a: main, base: base && baseline ? { name: baseline.name, analysis: base } : undefined, scriptName: script.name, boundaryText, flags }),
  );
  return { dir, verdict: report.verdict };
}

async function replay(manifestPath: string) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const { dir } = await quick(manifest.args);
  const again = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  const same = again.report_sha256 === manifest.report_sha256 && again.input.export_sha256 === manifest.input.export_sha256 && again.script.sha256 === manifest.script.sha256;
  process.stdout.write(`${same ? "REPLAY MATCH" : "REPLAY MISMATCH"}: ${dir}\n`);
  if (!same) process.exitCode = 1;
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "replay" && rest[0]) return replay(path.resolve(CALLER_DIR, rest[0]));
  if (command !== "quick") {
    process.stdout.write(USAGE);
    process.exitCode = command ? 1 : 0;
    return;
  }
  const { values } = parseArgs({
    args: rest,
    options: {
      script: { type: "string" },
      baseline: { type: "string" },
      export: { type: "string", default: path.join(REPO_DIR, "data/export.json") },
      pre: { type: "string", default: "worker-console" },
      runs: { type: "string", default: "500" },
      seed: { type: "string", default: "69" },
      workers: { type: "string" },
      out: { type: "string", default: path.join(REPO_DIR, "outputs/lab") },
    },
  });
  if (!values.script) throw new Error(`--script is required\n\n${USAGE}`);
  const { dir, verdict } = await quick({
    script: values.script,
    baseline: values.baseline,
    export: values.export!,
    pre: values.pre!,
    runs: Number(values.runs),
    seed: Number(values.seed),
    workers: values.workers ? Number(values.workers) : undefined,
    out: values.out!,
  });
  process.stdout.write(`${verdict}: ${path.join(dir, "summary.md")}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
}
