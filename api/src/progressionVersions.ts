export const PROGRESSION_VERSIONS = ["v321", "v41", "v43"] as const;
export type ProgressionVersion = (typeof PROGRESSION_VERSIONS)[number];
export const PUBLISHED_PROGRESSION_VERSION: ProgressionVersion = "v321";
export const DEFAULT_PROGRESSION_VERSION: ProgressionVersion = "v43";
export type VersionRole = "published" | "candidate" | "legacy";

const META: Record<ProgressionVersion, { label: string; role: VersionRole }> = {
  v321: { label: "NET 3.2", role: "published" },
  v43: { label: "v4.3", role: "candidate" },
  v41: { label: "v4.1", role: "legacy" },
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

/** Auto-compare partner: always published, unless published itself was picked. */
export function compareBaselineFor(v: ProgressionVersion): ProgressionVersion {
  return v === PUBLISHED_PROGRESSION_VERSION
    ? DEFAULT_PROGRESSION_VERSION
    : PUBLISHED_PROGRESSION_VERSION;
}
