import path from "node:path";
import { fileURLToPath } from "node:url";

export const LAB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const REPO_DIR = path.resolve(LAB_DIR, "..");
/** pnpm runs package scripts from lab/; INIT_CWD is where the user actually typed the command. */
export const CALLER_DIR = process.env.INIT_CWD || process.cwd();
/** Everything NET Lab keeps: registry, leagues, runs, timings. Point it at a volume in the cloud. */
export const DATA_DIR = path.resolve(CALLER_DIR, process.env.LAB_DATA_DIR || path.join(REPO_DIR, "outputs/lab"));
export const RUNS_DIR = path.join(DATA_DIR, "runs");
export const REGISTRY_DIR = path.join(DATA_DIR, "scripts");
export const LEAGUES_DIR = path.join(DATA_DIR, "leagues");
export const TIMINGS_FILE = path.join(DATA_DIR, "timings.jsonl");
export const MODELS_DIR = path.join(LAB_DIR, "models");
