import fs from "node:fs";
import path from "node:path";
import { parse as parseCsv } from "csv-parse/sync";
import { labDataDir, labRunsDir, streamLabRun, type LabEvent } from "./labCli.js";
import { repoRoot } from "../paths.js";

/** deep: every offseason, 10 seasons; season: after one simulated season; quick: once, right now. */
export const LAB_MODES = ["deep", "season", "quick"] as const;

export type LabRunSpec = {
  mode: (typeof LAB_MODES)[number];
  script: string;
  baseline?: string | null;
  league?: string;
  seed?: number;
  unlock?: { runs?: number; seasons?: number; replicates?: number };
};

export type LabStageProgress = { stage: string; text: string; done: number; total: number };
export type LabIssue = { level: string; code: string; text: string };

export type LiveRun = {
  queueId: string;
  runId: string | null;
  state: "queued" | "running" | "done" | "failed";
  spec: LabRunSpec;
  createdAt: string;
  startedAt?: string;
  estimateSeconds?: number;
  estimateBasis?: string[];
  stage?: string;
  stages: LabStageProgress[];
  issues: LabIssue[];
  elapsed: number;
  verdict?: string;
  error?: string;
};

export const RUN_ID_RE = /^\d{14}(-\d+)?$/;
export const QUEUE_ID_RE = /^q-\d+-\d+$/;
export const LAB_FILES = [
  "summary.md",
  "report.json",
  "players.csv",
  "players.baseline.csv",
  "deep.json",
  "manifest.json",
  "status.json",
  "regrade.json",
] as const;
export type LabFile = (typeof LAB_FILES)[number];

export function argsForSpec(spec: LabRunSpec): string[] {
  const args = ["--mode", spec.mode, "--script", spec.script];
  if (spec.baseline) args.push("--baseline", spec.baseline);
  if (spec.league) args.push("--league", spec.league);
  if (spec.seed !== undefined) args.push("--seed", String(spec.seed));
  if (spec.unlock) {
    args.push("--unlock");
    if (spec.unlock.runs !== undefined) args.push("--runs", String(spec.unlock.runs));
    if (spec.unlock.seasons !== undefined) args.push("--seasons", String(spec.unlock.seasons));
    if (spec.unlock.replicates !== undefined) args.push("--replicates", String(spec.unlock.replicates));
  }
  return args;
}

/**
 * One lab run at a time: runs are CPU-bound and use every core, so later
 * submissions wait in a FIFO queue with state "queued".
 */
export class LabRunQueue {
  private seq = 0;
  private readonly queue: LiveRun[] = [];
  private active: LiveRun | null = null;
  private readonly byQueueId = new Map<string, LiveRun>();
  private readonly byRunId = new Map<string, LiveRun>();
  private readonly waiters = new Map<string, ((r: LiveRun) => void)[]>();

  enqueue(spec: LabRunSpec): LiveRun {
    const run: LiveRun = {
      queueId: `q-${Date.now()}-${++this.seq}`,
      runId: null,
      state: "queued",
      spec,
      createdAt: new Date().toISOString(),
      stages: [],
      issues: [],
      elapsed: 0,
    };
    this.byQueueId.set(run.queueId, run);
    this.queue.push(run);
    this.pump();
    return run;
  }

  get(id: string): LiveRun | undefined {
    return this.byQueueId.get(id) ?? this.byRunId.get(id);
  }

  position(run: LiveRun): number {
    return this.queue.indexOf(run) + 1;
  }

  queued(): LiveRun[] {
    return [...this.queue];
  }

  /** Resolves once the run has an id (the CLI's run event) or has failed. */
  started(run: LiveRun): Promise<LiveRun> {
    if (run.runId || run.state === "failed" || run.state === "done") return Promise.resolve(run);
    return new Promise((resolve) => {
      const list = this.waiters.get(run.queueId) ?? [];
      list.push(resolve);
      this.waiters.set(run.queueId, list);
    });
  }

  private wake(run: LiveRun) {
    const list = this.waiters.get(run.queueId);
    if (!list) return;
    this.waiters.delete(run.queueId);
    for (const fn of list) fn(run);
  }

  private pump() {
    if (this.active || !this.queue.length) return;
    const run = this.queue.shift()!;
    this.active = run;
    run.state = "running";
    run.startedAt = new Date().toISOString();
    let lastError: string | undefined;
    streamLabRun(
      argsForSpec(run.spec),
      (e) => {
        if (e.type === "error") lastError = e.message;
        this.apply(run, e);
      },
      (code, stderr) => {
        if (run.state !== "done") {
          run.state = "failed";
          run.error = lastError ?? (stderr || `NET Lab exited with code ${code}`);
          if (run.runId) markStatusFailed(run.runId, run.error);
        }
        this.wake(run);
        this.active = null;
        this.pump();
      },
    );
  }

  private apply(run: LiveRun, e: LabEvent) {
    switch (e.type) {
      case "run":
        run.runId = e.runId;
        run.estimateSeconds = e.estimateSeconds;
        run.estimateBasis = e.estimateBasis;
        this.byRunId.set(e.runId, run);
        this.wake(run);
        break;
      case "stage":
        run.stage = e.stage;
        if (!run.stages.some((s) => s.stage === e.stage)) run.stages.push({ stage: e.stage, text: e.text, done: 0, total: 0 });
        break;
      case "progress": {
        let s = run.stages.find((x) => x.stage === e.stage);
        if (!s) {
          s = { stage: e.stage, text: e.stage, done: 0, total: 0 };
          run.stages.push(s);
        }
        s.done = e.done;
        s.total = e.total;
        run.elapsed = e.elapsed;
        break;
      }
      case "issue":
        run.issues.push({ level: e.level, code: e.code, text: e.text });
        break;
      case "done":
        run.state = "done";
        run.verdict = e.verdict;
        run.elapsed = e.seconds;
        break;
      case "error":
        run.error = e.message;
        break;
    }
  }
}

function markStatusFailed(runId: string, error: string) {
  const file = path.join(labRunsDir(), runId, "status.json");
  try {
    const status = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    if (status.state !== "running") return;
    Object.assign(status, { state: "failed", error, finishedAt: new Date().toISOString() });
    fs.writeFileSync(file, JSON.stringify(status, null, 2) + "\n");
  } catch {
    /* no status file to patch */
  }
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function readStatus(runId: string): Record<string, unknown> | null {
  return readJson(path.join(labRunsDir(), runId, "status.json")) as Record<string, unknown> | null;
}

/**
 * History rows from status.json. Each gains `lab` ({version, checksVersion}); runs from
 * before NET Lab 0.3 don't record it in status.json, so it comes from their manifest.
 */
export function listStatuses(): Record<string, unknown>[] {
  const dir = labRunsDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((d) => RUN_ID_RE.test(d))
    .sort()
    .reverse()
    .map((d) => {
      const status = readStatus(d);
      if (status && !status.lab) {
        const m = readJson(path.join(dir, d, "manifest.json")) as { lab_version?: string; lab?: { version?: string; checks?: { version?: number } } } | null;
        status.lab = m ? { version: m.lab?.version ?? m.lab_version ?? null, checksVersion: m.lab?.checks?.version ?? null } : null;
      }
      return status;
    })
    .filter((s): s is Record<string, unknown> => s !== null);
}

export type LabPlayer = Record<string, string | number | null> & { attrDelta: Record<string, number> };

const STRING_COLS = new Set(["name"]);

/** players.csv → typed rows; `d_<rating>` columns fold into `attrDelta`. */
export function parsePlayersCsv(text: string): LabPlayer[] {
  const rows = parseCsv(text, { columns: true, skip_empty_lines: true }) as Record<string, string>[];
  return rows.map((row) => {
    const out: Record<string, string | number | null> = {};
    const attrDelta: Record<string, number> = {};
    for (const [k, v] of Object.entries(row)) {
      if (k.startsWith("d_")) attrDelta[k.slice(2)] = Number(v);
      else if (STRING_COLS.has(k)) out[k] = v;
      else out[k] = v === "" || v === "null" ? null : Number(v);
    }
    return { ...out, attrDelta } as LabPlayer;
  });
}

function readPlayers(file: string): LabPlayer[] | null {
  try {
    return parsePlayersCsv(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** Path shown in the replay command: repo-relative when the data dir is inside the repo. */
export function manifestDisplayPath(runId: string): string {
  const abs = path.join(labRunsDir(), runId, "manifest.json");
  const rel = path.relative(repoRoot(), abs);
  return rel.startsWith("..") || path.isAbsolute(rel) ? abs : rel.split(path.sep).join("/");
}

export function runResults(runId: string) {
  const dir = path.join(labRunsDir(), runId);
  const files = LAB_FILES.filter((f) => fs.existsSync(path.join(dir, f)));
  let summary: string | null = null;
  try {
    summary = fs.readFileSync(path.join(dir, "summary.md"), "utf8");
  } catch {
    /* missing */
  }
  const manifestPath = manifestDisplayPath(runId);
  return {
    report: readJson(path.join(dir, "report.json")),
    deep: readJson(path.join(dir, "deep.json")),
    manifest: readJson(path.join(dir, "manifest.json")),
    summary,
    players: {
      script: readPlayers(path.join(dir, "players.csv")) ?? [],
      baseline: readPlayers(path.join(dir, "players.baseline.csv")),
    },
    files,
    manifestPath,
    replayCommand: `pnpm lab replay ${manifestPath}`,
  };
}

export function labFilePath(runId: string, name: LabFile): string {
  return path.join(labRunsDir(), runId, name);
}

export { labDataDir };
