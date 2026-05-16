export interface RunMetadata {
  build: string;
  script_version?: string | null;
  status: string;
  teams: string[];
  seed?: number | null;
  runs?: number | null;
  n_workers?: number | null;
  export_file?: string | null;
  export_title?: string | null;
  teaminfo_file?: string | null;
  teaminfo_source?: "generated" | "user";
  started_at?: string | null;
  completed_at?: string | null;
  player_count?: number | null;
  config_snapshot?: Record<string, unknown> | null;
  error?: string | null;
}

export interface PlayerSummary {
  PlayerID: string | number;
  Name: string;
  Team: string;
  Age: number;
  Baseline: number;
  MeanDelta: number;
  StdDelta: number;
  P05: number;
  P25: number;
  P50: number;
  P75: number;
  P95: number;
}

export interface GodProg {
  name: string;
  run_seed: number;
  age: number;
  ovr: number;
  bonus: number;
  chance: number;
}

export interface SimProgress {
  phase: string;
  pct: number;
  message: string;
  done: boolean;
}
