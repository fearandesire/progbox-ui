/**
 * Local mirror of api/src/progressionVersions.ts.
 * Switch to /api/config.version_meta if a fourth id ever ships.
 */
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

export function versionLabel(v: string): string {
  return META[v as ProgressionVersion]?.label ?? v;
}

export function versionRole(v: string): VersionRole | null {
  return META[v as ProgressionVersion]?.role ?? null;
}

/** Auto-compare partner: always published, unless published itself was picked. */
export function compareBaselineFor(v: ProgressionVersion): ProgressionVersion {
  return v === PUBLISHED_PROGRESSION_VERSION
    ? DEFAULT_PROGRESSION_VERSION
    : PUBLISHED_PROGRESSION_VERSION;
}

export function versionTitle(v: ProgressionVersion): string {
  switch (META[v].role) {
    case "published":
      return "Published script: live NET 3.2";
    case "candidate":
      return "Candidate script: v4.3";
    case "legacy":
      return "Legacy script: v4.1";
    default: {
      const _exhaustive: never = META[v].role;
      return _exhaustive;
    }
  }
}

/** CSS-safe class token (dots are invalid in unescaped class selectors). */
export function versionChipClass(v: ProgressionVersion): string {
  return v.replace(/\./g, "-");
}
