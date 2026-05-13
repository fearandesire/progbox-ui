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

export function deleteRun(build: string): boolean {
  if (!isValidBuildId(build)) return false;
  const target = path.join(outputsRoot(), build);
  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
    return false;
  }
  fs.rmSync(target, { recursive: true, force: true });
  return true;
}
