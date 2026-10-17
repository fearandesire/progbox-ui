import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { repoRoot } from "../paths.js";

/**
 * Thin wrapper around the NET Lab CLI (`lab/src/cli.ts`). The API never imports
 * lab code: every call goes through the CLI, so local and deployed setups run
 * the exact same contract.
 */

/** Resolve the lab data dir exactly like lab/src/paths.ts does (env or <repo>/outputs/lab). */
export function labDataDir(): string {
  const env = process.env.LAB_DATA_DIR?.trim();
  if (env) return path.resolve(process.env.INIT_CWD || process.cwd(), env);
  return path.join(repoRoot(), "outputs", "lab");
}

export function labRunsDir(): string {
  return path.join(labDataDir(), "runs");
}

export function labCliPath(): string {
  return process.env.LAB_CLI_PATH?.trim() || path.join(repoRoot(), "lab", "src", "cli.ts");
}

export class LabCliError extends Error {
  constructor(
    message: string,
    readonly code: number | null,
  ) {
    super(message);
    this.name = "LabCliError";
  }
}

function nodeArgs(): string[] {
  // Node >= 22.18 strips types by default; older 22.x needs the flag.
  const features = process.features as { typescript?: string | false };
  return features.typescript ? [] : ["--experimental-strip-types"];
}

/** Spawn the CLI with a pinned data dir; the child sees the same LAB_DATA_DIR the API reads. */
export function spawnLab(args: string[]): ChildProcess {
  const dataDir = labDataDir();
  fs.mkdirSync(dataDir, { recursive: true });
  return spawn(process.execPath, [...nodeArgs(), labCliPath(), ...args], {
    cwd: dataDir,
    env: { ...process.env, LAB_DATA_DIR: dataDir, INIT_CWD: dataDir, NODE_NO_WARNINGS: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

const cleanStderr = (s: string) =>
  s
    .split("\n")
    .filter((l) => l.trim() && !/ExperimentalWarning|--trace-warnings/.test(l))
    .join("\n")
    .trim();

/** Run a CLI command to completion and return stdout; throws LabCliError with the CLI's message. */
export function runLabCommand(args: string[], timeoutMs = 120_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawnLab(args);
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new LabCliError(`NET Lab timed out after ${Math.round(timeoutMs / 1000)}s`, null));
    }, timeoutMs);
    child.stdout?.on("data", (d: Buffer) => (stdout += d.toString("utf8")));
    child.stderr?.on("data", (d: Buffer) => (stderr += d.toString("utf8")));
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new LabCliError(`Could not start NET Lab: ${err.message}`, null));
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new LabCliError(cleanStderr(stderr) || `NET Lab exited with code ${code}`, code));
    });
  });
}

/** Run a CLI command whose stdout is one JSON document. */
export async function runLabJson<T>(args: string[], timeoutMs?: number): Promise<T> {
  const out = await runLabCommand(args, timeoutMs);
  try {
    return JSON.parse(out) as T;
  } catch {
    throw new LabCliError(`NET Lab returned output that isn't JSON: ${out.slice(0, 200)}`, 0);
  }
}

export type LabEvent =
  | { type: "run"; runId: string; dir: string; estimateSeconds: number; estimateBasis: string[] }
  | { type: "stage"; stage: string; text: string }
  | { type: "progress"; stage: string; done: number; total: number; elapsed: number }
  | { type: "issue"; level: string; code: string; text: string }
  | { type: "done"; runId: string; dir: string; verdict: string; seconds: number }
  | { type: "error"; message: string };

/** Start `run --json` and stream its LabEvents. `onExit` gets the exit code and stderr. */
export function streamLabRun(
  args: string[],
  onEvent: (e: LabEvent) => void,
  onExit: (code: number | null, stderr: string) => void,
): ChildProcess {
  const child = spawnLab(["run", "--json", ...args]);
  let stderr = "";
  let exited = false;
  const exit = (code: number | null) => {
    if (exited) return;
    exited = true;
    onExit(code, cleanStderr(stderr));
  };
  child.stderr?.on("data", (d: Buffer) => {
    stderr = (stderr + d.toString("utf8")).slice(-8000);
  });
  if (child.stdout) {
    const rl = readline.createInterface({ input: child.stdout });
    rl.on("line", (line) => {
      const t = line.trim();
      if (!t.startsWith("{")) return;
      try {
        onEvent(JSON.parse(t) as LabEvent);
      } catch {
        /* ignore non-event output */
      }
    });
  }
  child.on("error", (err) => {
    stderr += `\nCould not start NET Lab: ${err.message}`;
    exit(null);
  });
  child.on("close", (code) => exit(code));
  return child;
}
