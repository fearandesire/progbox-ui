/** Types mirroring the API's extracted-dashboard responses (analysisExtract.ts). */

export interface PlotlyFigureJson {
  data: unknown[];
  layout: Record<string, unknown>;
  config?: Record<string, unknown>;
}

export type ChartRef =
  | { kind: "figure"; payloadId: string; minHeight: number }
  | { kind: "player-explorer" };

export interface ExtractedSection {
  id: string;
  title: string;
  intro: string;
  charts: ChartRef[];
}

export interface StatCard {
  label: string;
  value: string;
  color: string | null;
}

export interface ExplorerPlayer {
  id: number | string;
  label: string;
  age: number;
  base: number;
  mean: number;
  std: number;
  p05: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
  pUp: number;
  pDn: number;
  pBig: number;
  mx: number;
  dx: number[];
  dp: number[];
  mode: "pmf" | "hist";
  attrs: Record<string, number>;
}

export interface ExplorerPayload {
  leagueMean: number;
  groupColors: Record<string, string>;
  players: ExplorerPlayer[];
}

export interface ExtractedDashboard {
  schemaVersion: 1;
  hero: { title: string; subtitle: string };
  statCards: StatCard[];
  sections: ExtractedSection[];
  figures: Record<string, PlotlyFigureJson>;
  playerExplorer: ExplorerPayload | null;
}

export interface ParsedScorecard {
  scripts: string[];
  colors: string[];
  metrics: { name: string; values: (number | null)[] }[];
}

export interface AnalysisDataResponse extends ExtractedDashboard {
  engine: "python";
  build: string;
}

export interface CompareDataResponse extends ExtractedDashboard {
  engine: "python";
  builds: string[];
  scorecard: ParsedScorecard | null;
}
