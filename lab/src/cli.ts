import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { estimateRun, ingest, listRuns, registry, replay, resolveScript, runLab, type LabEvent, type RunSpec } from "./lab.ts";
import { addLeague, DEFAULT_LEAGUE, fetchLeagues, listLeagues, prepareLeague } from "./leagues.ts";
import { CALLER_DIR, DATA_DIR, MODELS_DIR } from "./paths.ts";
import { DEFAULT_MODE, PRESETS, type Mode } from "./presets.ts";
import type { Role } from "./registry.ts";
import { calibrate } from "./statgen/calibrate.ts";
import { fitStatGen, loadCorpus } from "./statgen/fit.ts";

const USAGE = `NET Lab

  pnpm lab run --script <id|file> [--baseline <id|file>] [--mode deep|quick] [--league <id|file>]
  pnpm lab quick --script <id|file> [--baseline <id|file>]      (same as run --mode quick)
  pnpm lab estimate --script <id|file> [--baseline ...] [--mode ...]
  pnpm lab replay <manifest.json>
  pnpm lab runs
  pnpm lab scripts list | add <file> [--family net] [--role draft] | promote <id> <role>
  pnpm lab leagues list | fetch | add <file> [--name ...] | check <id|file>
  pnpm lab statgen fit --corpus <dir,...> [--holdout <dir,...>]
  pnpm lab setup        Check this machine, download leagues, run a short smoke test

Scripts get a forced, immutable version id (net@4.4.0-draft.1). Builtins: net-3.2.1, net-4.3.0, worker-console.
Run sizes are locked: quick ${PRESETS.quick.runs} offseasons; deep ${PRESETS.deep.replicates} replicates × ${PRESETS.deep.seasons} seasons.
Default mode: ${DEFAULT_MODE}. Default league: ${DEFAULT_LEAGUE}. Data dir: ${DATA_DIR} (set LAB_DATA_DIR to move it).

Run options:
  --pre <id|file|none>  Pre-progs hook (default: worker-console)
  --seed <n>            Base seed (default: 69)
  --workers <n>         Worker threads (default: cores - 1)
  --unlock --runs <n> --seasons <n> --replicates <n>   Override locked sizes (advanced)
  --json                Print one JSON event per line (for the API and agents)
`;

const out = (v: unknown) => process.stdout.write(`${typeof v === "string" ? v : JSON.stringify(v, null, 2)}\n`);
const abs = (p: string) => path.resolve(CALLER_DIR, p);
/** File refs resolve from where the user typed the command; ids and builtins pass through. */
const ref = (r: string | undefined) => (r && fs.existsSync(abs(r)) ? abs(r) : r);

function specFrom(values: Record<string, any>, mode?: Mode): RunSpec {
  if (!values.script) throw new Error(`--script is required\n\n${USAGE}`);
  const unlock = values.unlock ? { runs: num(values.runs), seasons: num(values.seasons), replicates: num(values.replicates) } : undefined;
  if (!values.unlock && (values.runs || values.seasons || values.replicates)) throw new Error("Run sizes are locked. Add --unlock to override them.");
  return {
    mode: mode ?? (values.mode as Mode | undefined) ?? DEFAULT_MODE,
    script: ref(values.script)!,
    baseline: ref(values.baseline) ?? null,
    league: ref(values.league),
    pre: values.pre === "none" ? "none" : ref(values.pre),
    seed: num(values.seed),
    unlock,
    workers: num(values.workers),
  };
}
const num = (v: unknown) => (v === undefined ? undefined : Number(v));

function printer(json: boolean) {
  let last = 0;
  return (e: LabEvent) => {
    if (json) return out(JSON.stringify(e));
    if (e.type === "run") process.stderr.write(`Run ${e.runId}: estimated ${e.estimateSeconds}s\n`);
    if (e.type === "stage") process.stderr.write(`${e.text}\n`);
    if (e.type === "issue" && e.level !== "fix") process.stderr.write(`  league ${e.level}: ${e.text}\n`);
    if (e.type === "issue" && e.level === "fix") process.stderr.write(`  league fix: ${e.text}\n`);
    if (e.type === "progress" && (e.done === e.total || Date.now() - last > 2000)) {
      last = Date.now();
      process.stderr.write(`  ${e.done}/${e.total} (${e.elapsed.toFixed(0)}s)\n`);
    }
  };
}

const OPTIONS = {
  script: { type: "string" },
  baseline: { type: "string" },
  mode: { type: "string" },
  league: { type: "string" },
  export: { type: "string" },
  pre: { type: "string" },
  seed: { type: "string" },
  workers: { type: "string" },
  unlock: { type: "boolean" },
  runs: { type: "string" },
  seasons: { type: "string" },
  replicates: { type: "string" },
  json: { type: "boolean" },
  family: { type: "string" },
  role: { type: "string" },
  name: { type: "string" },
  corpus: { type: "string" },
  holdout: { type: "string" },
  out: { type: "string" },
} as const;

async function main() {
  const { values, positionals } = parseArgs({ args: process.argv.slice(2), options: OPTIONS, allowPositionals: true });
  const [command, sub, ...rest] = positionals;
  if (values.export && !values.league) values.league = values.export;
  const json = !!values.json;

  switch (command) {
    case "run":
    case "quick": {
      const { dir, verdict } = await runLab(specFrom(values, command === "quick" ? "quick" : undefined), printer(json));
      if (!json) out(`${verdict}: ${path.join(dir, "summary.md")}`);
      return;
    }
    case "estimate":
      return out(await estimateRun(specFrom(values)));
    case "replay": {
      if (!sub) throw new Error("usage: pnpm lab replay <manifest.json>");
      const { same, dir } = await replay(abs(sub), printer(json));
      out(`${same ? "REPLAY MATCH" : "REPLAY MISMATCH"}: ${dir}`);
      if (!same) process.exitCode = 1;
      return;
    }
    case "runs":
      return out(listRuns());
    case "scripts": {
      const reg = registry();
      if (sub === "add") {
        if (!rest[0]) throw new Error("usage: pnpm lab scripts add <file>");
        const added = reg.add(fs.readFileSync(abs(rest[0]), "utf8"), { family: values.family, role: values.role as Role | undefined, source: `file:${path.basename(rest[0])}` });
        return out(json ? added : added.notes.join("\n"));
      }
      if (sub === "promote") return out(reg.promote(rest[0]!, rest[1] as Role));
      if (sub === "show") return out(resolveScript(rest[0]!, reg).entry);
      return out(reg.list().map(({ id, role, sha256, createdAt, source }) => ({ id, role, sha256: sha256.slice(0, 12), createdAt, source })));
    }
    case "leagues": {
      if (sub === "fetch") return fetchLeagues((s) => process.stderr.write(`${s}\n`));
      if (sub === "add") {
        if (!rest[0]) throw new Error("usage: pnpm lab leagues add <file>");
        const info = addLeague(fs.readFileSync(abs(rest[0])), values.name ?? path.basename(rest[0]));
        const v = prepareLeague(info.id).validation;
        return out({ league: info, validation: v });
      }
      if (sub === "check") {
        const target = ref(rest[0]) ?? DEFAULT_LEAGUE;
        const v = prepareLeague(target).validation;
        if (v.ok && v.imputed.length) ingest(target);
        return out(json ? v : [`${v.ok ? "OK" : "BLOCKED"}: season ${v.season}, phase ${v.phase}`, ...v.issues.map((i) => `  ${i.level}: ${i.text}`)].join("\n"));
      }
      return out(listLeagues());
    }
    case "setup":
      return setup();
    case "statgen": {
      if (sub !== "fit" || !values.corpus) throw new Error("usage: pnpm lab statgen fit --corpus <dir,...> [--holdout <dir,...>]");
      const dirs = (s: string) => s.split(",").map(abs);
      const model = fitStatGen(loadCorpus(dirs(values.corpus)), { zengm: process.env.ZENGM_REV ?? "unknown", version: `statgen-${new Date().toISOString().slice(0, 10)}` });
      if (values.holdout) model.calibration = calibrate(model, loadCorpus(dirs(values.holdout)));
      const file = values.out ? abs(values.out) : path.join(MODELS_DIR, "statgen.json");
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(model));
      const c = model.calibration as { pass: boolean; maxKs: number; maxCorrDiff: number } | undefined;
      return out(`Wrote ${file}${c ? ` · calibration ${c.pass ? "PASS" : "FAIL"} (max KS ${c.maxKs}, max corr diff ${c.maxCorrDiff})` : ""}`);
    }
    default:
      out(USAGE);
      process.exitCode = command ? 1 : 0;
  }
}

/** Guided setup: each step says what it checked and what to do if it fails. */
async function setup() {
  const step = (ok: boolean, text: string, fix?: string) => {
    out(`${ok ? "✓" : "✗"} ${text}${ok || !fix ? "" : `\n    fix: ${fix}`}`);
    if (!ok) throw new Error("setup stopped; fix the step above and run pnpm lab setup again");
  };
  const [major, minor] = process.versions.node.split(".").map(Number) as [number, number];
  step(major > 22 || (major === 22 && minor >= 18), `Node ${process.versions.node} (needs 22.18+ to run TypeScript directly)`, "install Node 22 LTS or newer");
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.accessSync(DATA_DIR, fs.constants.W_OK);
  step(true, `Data dir ${DATA_DIR} is writable (set LAB_DATA_DIR to move it)`);
  await fetchLeagues((s) => out(`  ${s}`));
  const missing = listLeagues().filter((l) => !l.available);
  step(!missing.length, "Leagues downloaded and hash-checked", `download failed for ${missing.map((l) => l.id).join(", ")}; check network access to github.com`);
  const modelFile = path.join(MODELS_DIR, "statgen.json");
  const model = fs.existsSync(modelFile) ? JSON.parse(fs.readFileSync(modelFile, "utf8")) : null;
  step(!!model?.calibration?.pass, `StatGen model ${model?.version ?? "missing"} passed its calibration gate`, "run bash lab/local-runner/run-corpus.sh on your own machine to rebuild it");
  const v = prepareLeague(DEFAULT_LEAGUE).validation;
  step(v.ok, `Default league ${DEFAULT_LEAGUE} validates (${v.issues.filter((i) => i.level === "fix").length} automatic fixes)`);
  const { verdict, dir } = await runLab({ mode: "deep", script: "net-4.3.0", baseline: "net-3.2.1", unlock: { runs: 20, seasons: 2, replicates: 4 } }, () => {});
  step(true, `Smoke run finished (${verdict}): ${dir}`);
  out("NET Lab is ready. Start the app with pnpm dev and open /lab, or run pnpm lab run --script <file>.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
}
