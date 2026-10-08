/** Shapes returned by /api/lab (they mirror the NET Lab CLI's JSON output). */

export type LabMode = "deep" | "quick";

export interface LabScript {
  id: string;
  role: "draft" | "candidate" | "published";
  sha256: string;
  createdAt: string;
  source: string;
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

export interface LabReport {
  verdict: string;
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
