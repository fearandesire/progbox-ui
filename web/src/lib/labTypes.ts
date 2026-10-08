/** Shapes returned by /api/lab (they mirror the NET Lab CLI's JSON output). */

/** deep = every offseason for N seasons, season = after one season, quick = right now. */
export type LabMode = "deep" | "season" | "quick";

export type LabRole = "draft" | "candidate" | "published";

/** Set when the header's version was taken by other code and NET Lab forced it up. */
export interface LabBump {
  from: string;
  to?: string;
  /** The id that already held `from` (family@from). */
  collidedWith?: string;
  originalSha256?: string;
  originalFile?: string;
}

/** GET /api/lab/scripts entry (lab v2 contract). Older APIs only send id/role/sha256/createdAt/source. */
export interface LabScript {
  id: string;
  role: LabRole;
  sha256: string;
  source: string;
  family?: string;
  builtin?: boolean;
  uploadedFile?: string | null;
  uploadedAt?: string | null;
  createdAt?: string;
  runs?: number;
  header?: string | null;
  bumped?: LabBump | null;
}

export interface LabScriptDeleted {
  id: string;
  trashedUntil: string;
}

export type LabDiffOp = "ctx" | "add" | "del";

export interface LabDiffRow {
  op: LabDiffOp;
  a: number | null;
  b: number | null;
  text: string;
}

export interface LabDiff {
  against: string;
  rows: LabDiffRow[];
}

export interface LabScriptEntry {
  id: string;
  family: string;
  version: string;
  role: string;
  sha256: string;
  source: string;
  declared: string | null;
}

export interface LabScriptAdded {
  entry: LabScriptEntry;
  created: boolean;
  notes: string[];
}

export interface LabLeague {
  id: string;
  name: string;
  source: string;
  credit?: string;
  url?: string;
  isDefault?: boolean;
  available: boolean;
}

export interface LabIssue {
  level: "error" | "warn" | "fix" | string;
  code: string;
  text: string;
}

export interface LabValidation {
  ok: boolean;
  issues: LabIssue[];
  season: number;
  phase: number;
  imputed: string[];
}

export interface LabEstimate {
  seconds: number;
  basis: string[];
}

export interface LabUnlock {
  runs?: number;
  seasons?: number;
  replicates?: number;
}

export interface LabRunInput {
  mode: LabMode;
  script: string;
  baseline?: string | null;
  league?: string;
  seed?: number;
  unlock?: LabUnlock;
}

export interface LabRunCreated {
  runId: string | null;
  queueId: string;
  state: LabRunState;
  position?: number;
  estimateSeconds?: number | null;
  estimateBasis?: string[];
}

export type LabRunState = "queued" | "running" | "done" | "failed";

export interface LabStageProgress {
  stage: string;
  text: string;
  done: number;
  total: number;
}

export interface LabRunSummary {
  runId: string | null;
  queueId?: string;
  state: LabRunState;
  mode: LabMode;
  script: string;
  baseline: string | null;
  league: string | null;
  startedAt?: string | null;
  createdAt?: string;
  finishedAt?: string;
  verdict?: string | null;
  seconds?: number;
  seed?: number;
  /** NET Lab version that made the run (lab v2). Absent on older runs. */
  lab?: LabRunListMeta | null;
  /** Balance-check result from status.json (lab v2). */
  checks?: { verdict: "better" | "worse" | "mixed" | null; script: { passed: number; applicable: number }; baseline: { passed: number; applicable: number } | null } | null;
  error?: string | null;
  position?: number;
}

export interface LabKpis {
  runs: number;
  failedRuns: number;
  invalidRows: number;
  progressedPerRun: number;
  meanDelta: number;
  sdDelta: number;
  pctPositive: number;
  pctNegative: number;
  deltaByAge: Record<string, { n: number; meanDelta: number }>;
  godProgsPerRun: number;
  medianPlayerSd: number;
  over80Before: number;
  over80After: number;
  p99OvrAfter: number;
  perEffect: number | null;
  bpmEffect: number | null;
}

export interface LabFlag {
  level: "error" | "warn";
  text: string;
}

export interface LabStat {
  mean: number;
  se: number;
}

export interface LabDeepSeason {
  season: number;
  progressed: LabStat;
  meanDelta: LabStat;
  god: LabStat;
  leagueMeanOvr: LabStat;
  count75: LabStat;
  count80: LabStat;
  maxOvr: LabStat;
  retired: LabStat;
  drafted: LabStat;
}

export interface LabTrajectory {
  pid: number;
  name?: string;
  ovr: { mean: number; p10: number; p90: number; active: number }[];
}

export interface LabDeepSide {
  replicates: number;
  failed: number;
  seasons: LabDeepSeason[];
  ageCurve: Record<string, number>;
  trajectories: LabTrajectory[];
}

/** Version stamp written by every run since NET Lab 0.3.0. */
export interface LabMeta {
  version: string;
  commit: string | null;
  checks: { version: number; rulesSha256: string };
  statgen: string | null;
}

/** History list entries carry a short form of LabMeta; accept either shape. */
export interface LabRunListMeta {
  version: string | null;
  checksVersion?: number | null;
  checks?: number | { version: number; rulesSha256?: string } | null;
}

export interface LabRunDetails {
  mode: LabMode;
  netRuns: string;
  gamesSimulated: boolean;
  statsRead: string;
  league: { id: string; name: string };
  runs: number;
  seasons: number | null;
  seed: number;
  scripts: { id: string; sha256: string }[];
  pre: { id: string; sha256: string } | null;
}

export type LabCheckId = "league-ovr" | "star-count" | "superstars" | "god-progs" | "production" | "predictable" | "aging";
export type LabDirection = "better" | "worse" | "same";

export interface LabCheckValue {
  value: number | number[];
  display: string;
  pass: boolean | null;
  /** Change from the start of the run, in percent (68 means +68%). */
  pctFromStart: number | null;
}

export interface LabCheckItem {
  id: LabCheckId | string;
  name: string;
  unit: string;
  rule: string;
  applicable: boolean;
  script: LabCheckValue;
  baseline: LabCheckValue | null;
  noScript: { value: number | number[]; display: string } | null;
  /** Relative difference script vs baseline, in percent. */
  change: { pct: number | null; direction: LabDirection; note: string } | null;
}

export interface LabChecks {
  version: number;
  rulesSha256: string;
  verdict: "better" | "worse" | "mixed" | null;
  script: { passed: number; applicable: number };
  baseline: { passed: number; applicable: number } | null;
  items: LabCheckItem[];
}

export interface LabReport {
  verdict: string;
  lab?: LabMeta | null;
  runDetails?: LabRunDetails | null;
  checks?: LabChecks | null;
  flags: LabFlag[];
  mode: LabMode;
  league: { id: string; name: string; credit: string | null; issues: LabIssue[]; imputedRows: number };
  script: { id: string; kpis: LabKpis; apiCalls: Record<string, number>; eventTypes: Record<string, number>; errors: unknown[] };
  baseline: { id: string; kpis: LabKpis; apiCalls: Record<string, number>; errors: unknown[] } | null;
  deep: unknown;
}

export interface LabPlayer {
  pid: number;
  name: string;
  tid: number;
  age: number;
  per: number | null;
  bpm: number | null;
  baseOvr: number;
  runs: number;
  meanOvr: number;
  meanDelta: number;
  sdDelta: number;
  min: number;
  q10: number;
  median: number;
  q90: number;
  max: number;
  pctPositive: number;
  godRate: number;
  attrDelta: Record<string, number>;
}

export interface LabResults {
  report: LabReport | null;
  deep: { script: LabDeepSide; baseline: LabDeepSide | null } | null;
  manifest: Record<string, unknown> | null;
  summary: string | null;
  players: { script: LabPlayer[]; baseline: LabPlayer[] | null };
  files: string[];
  manifestPath: string;
  replayCommand: string;
}

export interface LabRunDetail extends LabRunSummary {
  estimateSeconds?: number | null;
  estimateBasis?: string[];
  stage?: string | null;
  stageText?: string;
  stages?: LabStageProgress[];
  progress?: { stage: string; done: number; total: number };
  issues?: LabIssue[];
  elapsed?: number;
  results: LabResults | null;
}
