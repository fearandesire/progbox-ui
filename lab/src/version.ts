import { execFileSync } from "node:child_process";
import { REPO_DIR } from "./paths.ts";
import { CHECKS_VERSION, rulesSha256 } from "./verdict.ts";

/**
 * NET Lab's own version. Bump it when the simulation, StatGen use or report
 * numbers change, and add a line to lab/CHANGELOG.md saying what and why.
 * Pass rules have their own version (CHECKS_VERSION in verdict.ts).
 */
export const LAB_VERSION = "0.3.0";

export type LabMeta = {
  version: string;
  commit: string | null;
  checks: { version: number; rulesSha256: string };
  statgen: string | null;
};

let commit: string | null | undefined;

/** Short git commit of this checkout; LAB_COMMIT wins (a container has no .git). */
export function labCommit(): string | null {
  if (commit !== undefined) return commit;
  const env = process.env.LAB_COMMIT?.trim();
  if (env) return (commit = env.slice(0, 12));
  try {
    commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: REPO_DIR, stdio: ["ignore", "pipe", "ignore"], timeout: 5000 }).toString().trim() || null;
  } catch {
    commit = null;
  }
  return commit;
}

export function labMeta(statgen: string | null): LabMeta {
  return { version: LAB_VERSION, commit: labCommit(), checks: { version: CHECKS_VERSION, rulesSha256: rulesSha256() }, statgen };
}
