import type { LabMode, LabRole, LabScript, LabValidation } from "./labTypes";

export const ROLE_NAME: Record<LabRole, string> = { draft: "Draft", candidate: "Next release", published: "Published" };

export const ROLE_TIP: Record<LabRole, string> = {
  draft: "Uploaded for testing. You can delete it.",
  candidate: "The pending release, next in line to ship. Locked.",
  published: "What leagues run today. Locked.",
};

export const FAMILY_NAME: Record<string, string> = {
  net: "NET scripts",
  hook: "WorkerConsole hook, runs before NET every offseason",
};

export function familyOf(s: Pick<LabScript, "id" | "family">): string {
  return s.family ?? s.id.split("@")[0] ?? s.id;
}

export function familyLabel(family: string, count: number): string {
  return `${FAMILY_NAME[family] ?? `${family} scripts`} · ${count} ${count === 1 ? "version" : "versions"}`;
}

export function isBuiltin(s: Pick<LabScript, "builtin" | "source">): boolean {
  return s.builtin ?? s.source.startsWith("builtin");
}

export function uploadedAt(s: Pick<LabScript, "uploadedAt" | "createdAt">): string | null {
  return s.uploadedAt ?? s.createdAt ?? null;
}

/** Hook scripts run before NET; they are never the script under test or the comparison. */
export function isProgScript(s: Pick<LabScript, "id" | "family">): boolean {
  return familyOf(s) !== "hook";
}

/** Drafts the user uploaded: the only scripts offered under Script to test. Newest first. */
export function uploads(scripts: LabScript[]): LabScript[] {
  return scripts
    .filter((s) => s.role === "draft" && !isBuiltin(s) && isProgScript(s))
    .sort((a, b) => (uploadedAt(b) ?? "").localeCompare(uploadedAt(a) ?? "") || compareVersions(b.id, a.id));
}

function parseVersion(id: string): { nums: number[]; pre: (number | string)[] } {
  const v = id.includes("@") ? id.slice(id.indexOf("@") + 1) : id;
  const [main = "", pre] = v.split(/-(.*)/s);
  return {
    nums: main.split(".").map((n) => Number(n) || 0),
    pre: pre ? pre.split(".").map((p) => (/^\d+$/.test(p) ? Number(p) : p)) : [],
  };
}

/** Semver-ish order on the version part of ids: 4.4.0-draft.2 < 4.4.0-draft.10 < 4.4.0. */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a);
  const y = parseVersion(b);
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length); i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
    if (d) return d;
  }
  if (!x.pre.length || !y.pre.length) return (x.pre.length ? -1 : 0) - (y.pre.length ? -1 : 0);
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    if (typeof p === "number" && typeof q === "number") return p - q;
    return String(p).localeCompare(String(q));
  }
  return 0;
}

/** Releases for Compare against: next release first, then published, newest version first within each. */
export function releases(scripts: LabScript[]): LabScript[] {
  const rank = (r: LabRole) => (r === "candidate" ? 0 : 1);
  return scripts
    .filter((s) => s.role !== "draft" && isProgScript(s))
    .sort((a, b) => rank(a.role) - rank(b.role) || compareVersions(b.id, a.id));
}

/** Default comparison: the newest release (next release, else newest published), else none. */
export function defaultBaseline(scripts: LabScript[]): string {
  return releases(scripts)[0]?.id ?? "";
}

/** Drafts offered under Compare against, newest version first. */
export function baselineDrafts(scripts: LabScript[]): LabScript[] {
  return scripts.filter((s) => s.role === "draft" && isProgScript(s)).sort((a, b) => compareVersions(b.id, a.id));
}

/** Scripts table order: family groups (net first, hook last), then releases, then newest version. */
export function tableOrder(scripts: LabScript[]): LabScript[] {
  const famRank = (f: string) => (f === "net" ? 0 : f === "hook" ? 2 : 1);
  return [...scripts].sort(
    (a, b) =>
      famRank(familyOf(a)) - famRank(familyOf(b)) ||
      familyOf(a).localeCompare(familyOf(b)) ||
      compareVersions(b.id, a.id),
  );
}

export type StatusFilter = "all" | "draft" | "official";

export function matchesScript(s: LabScript, q: string, status: StatusFilter): boolean {
  if (status === "draft" && s.role !== "draft") return false;
  if (status === "official" && s.role === "draft") return false;
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return `${s.id} ${s.uploadedFile ?? ""} ${s.source}`.toLowerCase().includes(needle);
}

export function bumpTip(s: LabScript): string {
  const file = s.uploadedFile ?? "Your upload";
  return `Auto-bumped: ${file} said v${s.bumped?.from}, which already holds different code. Click to see the script and what changed.`;
}

export function runsText(n: number): string {
  return `${n} run${n === 1 ? "" : "s"}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Upload time for the table: "12 min ago", "2 h ago", "yesterday", "Sep 19", "May 2024". */
export function uploadedText(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "–";
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "–";
  const mins = Math.max(0, Math.floor((now - t.getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  if (hrs < 48) return "yesterday";
  const n = new Date(now);
  if (hrs < 24 * 7) return `${Math.floor(hrs / 24)} days ago`;
  return t.getFullYear() === n.getFullYear() ? `${MONTHS[t.getMonth()]} ${t.getDate()}` : `${MONTHS[t.getMonth()]} ${t.getFullYear()}`;
}

/* ---------- When NET runs ---------- */

export interface ModeInfo {
  mode: LabMode;
  title: string;
  tag: string;
  line: string;
  tip: string;
  netRuns: string;
  games: string;
}

/** BBGM season 2025 in an alexnoob file is the 2025-26 season. */
export function seasonLabel(season: number): string {
  return `${season}-${String((season + 1) % 100).padStart(2, "0")}`;
}

export function modeInfo(mode: LabMode, season: number | null): ModeInfo {
  const this_ = season !== null ? seasonLabel(season) : "this";
  if (mode === "season") {
    return {
      mode,
      title: "After one season",
      tag: "Simulated games",
      line: "Plays out this season, then runs NET once",
      tip: `Plays the ${this_} season with StatGen, then runs the hook and your script once on those simulated stats. Use it to see one offseason after a full season of play.`,
      netRuns: `Once, after the ${this_} season`,
      games: "Simulated (StatGen)",
    };
  }
  if (mode === "quick") {
    return {
      mode,
      title: "Right now",
      tag: "Real stats only",
      line: "Runs NET once on the stats in the file",
      tip: "No games are played and no stats are made up. The hook and your script run once on the league exactly as the file has it, 1000 times with different dice rolls.",
      netRuns: "Once, right now",
      games: "None played",
    };
  }
  return {
    mode: "deep",
    title: "Every offseason, 10 seasons",
    tag: "Simulated games",
    line: "Like running NET in your league for 10 years",
    tip: "Each run plays 10 seasons back to back, in BBGM's order. Players put up regular-season stats from their current ratings, then older players retire, the draft class comes in, and preseason development runs (a model fit to BBGM's own progs). The hook runs with last season's ages, as you run it before progs, then your script runs in preseason, as it would in your league, so a player NET boosts plays better next season and that feeds their next prog. The comparison script gets its own league with the same dice rolls.",
    netRuns: "Every offseason, 10 seasons",
    games: "Simulated (StatGen)",
  };
}

export const MODES: LabMode[] = ["deep", "season", "quick"];

/** BBGM phases 1 and 2 are the regular season (before and after the trade deadline). */
export function isMidSeason(v: Pick<LabValidation, "phase"> | null | undefined): boolean {
  return !!v && (v.phase === 1 || v.phase === 2);
}

/** Which season's stats NET reads, for the Run preview. */
export function statsReadText(mode: LabMode, v: Pick<LabValidation, "season" | "phase"> | null | undefined, seasons = 10): string {
  if (!v) return "–";
  const started = v.phase >= 1;
  const real = seasonLabel(started ? v.season : v.season - 1);
  if (mode === "quick") return isMidSeason(v) ? `${real} partial, from the file` : `${real} real, from the file`;
  if (mode === "season") return `Simulated ${seasonLabel(v.season)}`;
  return `${real} real, then ${seasons - 1} simulated seasons`;
}

/** Short estimate: "~7 min". Anything under a minute reads "~1 min". */
export function etaText(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "";
  return `~${Math.max(1, Math.round(seconds / 60))} min`;
}
