export const PROGRESSION_VERSIONS = ["v3.2.1", "v4.1", "v4.3"] as const;
export type ProgressionVersion = (typeof PROGRESSION_VERSIONS)[number];
export const PUBLISHED_PROGRESSION_VERSION: ProgressionVersion = "v3.2.1";
export const DEFAULT_PROGRESSION_VERSION: ProgressionVersion = "v4.3";
export type VersionRole = "published" | "candidate" | "legacy";

const META: Record<ProgressionVersion, { label: string; role: VersionRole }> = {
  "v3.2.1": { label: "NET 3.2", role: "published" },
  "v4.3": { label: "v4.3", role: "candidate" },
  "v4.1": { label: "v4.1", role: "legacy" },
};

/**
 * Map public catalog ids to the C++ engine's CLI `-v` identifiers.
 * API/UI use dotted NET tags (`v3.2.1` / `v4.1` / `v4.3`); the vendored binary
 * still registers compact ids (`v321` / `v41` / `v43`).
 */
const ENGINE_SCRIPT_IDS: Record<ProgressionVersion, string> = {
  "v3.2.1": "v321",
  "v4.1": "v41",
  "v4.3": "v43",
};

export function versionLabel(v: string): string {
  return META[v as ProgressionVersion]?.label ?? v;
}

export function versionRole(v: string): VersionRole | null {
  return META[v as ProgressionVersion]?.role ?? null;
}

export function versionMeta() {
  return PROGRESSION_VERSIONS.map((id) => ({ id, ...META[id] }));
}

/** CLI id passed to `progbox -v` (may differ from the public catalog id). */
export function engineScriptId(v: ProgressionVersion): string {
  return ENGINE_SCRIPT_IDS[v];
}

/** Auto-compare partner: always published, unless published itself was picked. */
export function compareBaselineFor(v: ProgressionVersion): ProgressionVersion {
  return v === PUBLISHED_PROGRESSION_VERSION
    ? DEFAULT_PROGRESSION_VERSION
    : PUBLISHED_PROGRESSION_VERSION;
}
