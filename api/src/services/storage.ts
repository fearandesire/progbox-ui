import fs from "node:fs";
import path from "node:path";
import { isValidBuildId } from "../buildId.js";
import type { RunMetadata } from "../types.js";
import { outputsRoot } from "../paths.js";

function metadataPath(build: string): string {
  return path.join(outputsRoot(), build, "metadata.json");
}

export function listRuns(): RunMetadata[] {
  const root = outputsRoot();
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    return [];
  }
  const runs: RunMetadata[] = [];
  const children = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
    .reverse();

  for (const name of children) {
    if (!isValidBuildId(name)) continue;
    const meta = path.join(root, name, "metadata.json");
    if (!fs.existsSync(meta)) continue;
    const loaded = getRun(name);
    if (loaded) runs.push(loaded);
  }
  return runs;
}

function isValidRunMetadata(data: unknown, expectedBuild: string): data is RunMetadata {
  if (!data || typeof data !== "object") return false;
  const obj = data as Record<string, unknown>;

  // Required fields
  if (typeof obj.build !== "string" || obj.build !== expectedBuild) return false;
  if (typeof obj.status !== "string") return false;
  if (!Array.isArray(obj.teams)) return false;

  return true;
}

export function getRun(build: string): RunMetadata | null {
  if (!isValidBuildId(build)) return null;
  const p = metadataPath(build);
  if (!fs.existsSync(p)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(p, "utf8"));
    if (!isValidRunMetadata(data, build)) return null;
    return data as RunMetadata;
  } catch {
    return null;
  }
}

/** Drop pair fields so a surviving sibling no longer links to a deleted run. */
function clearPairFields(meta: RunMetadata): RunMetadata {
  const next = { ...meta };
  delete next.pair_id;
  delete next.pair_role;
  delete next.paired_with;
  return next;
}

function writeClearedPairMetadata(siblingBuild: string, sibling: RunMetadata): void {
  const p = metadataPath(siblingBuild);
  try {
    fs.writeFileSync(p, JSON.stringify(clearPairFields(sibling), null, 2), "utf8");
  } catch {
    // Best-effort: deletion of the target run still proceeds.
  }
}

/**
 * When one member of an auto-comparison pair is deleted, strip pair metadata from
 * any surviving sibling so UI nav/compare links do not point at a missing build.
 */
function unlinkPairedSiblings(build: string, meta: RunMetadata | null): void {
  const siblingBuilds = new Set<string>();
  if (meta?.paired_with && isValidBuildId(meta.paired_with)) {
    siblingBuilds.add(meta.paired_with);
  }
  // Also catch one-sided links (corrupt/partial metadata on the deleted run).
  for (const run of listRuns()) {
    if (run.build !== build && run.paired_with === build) {
      siblingBuilds.add(run.build);
    }
  }

  for (const siblingBuild of siblingBuilds) {
    const sibling = getRun(siblingBuild);
    if (!sibling) continue;
    // Only clear when the sibling still references this run, or shares the same pair_id.
    const linksToDeleted = sibling.paired_with === build;
    const samePair =
      meta?.pair_id != null && sibling.pair_id != null && sibling.pair_id === meta.pair_id;
    if (!linksToDeleted && !samePair) continue;
    writeClearedPairMetadata(siblingBuild, sibling);
  }
}

export function deleteRun(build: string): boolean {
  if (!isValidBuildId(build)) return false;
  const target = path.join(outputsRoot(), build);
  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
    return false;
  }
  // Read pair metadata before the directory goes away, then drop sibling links.
  unlinkPairedSiblings(build, getRun(build));
  fs.rmSync(target, { recursive: true, force: true });
  return true;
}
