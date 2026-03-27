export interface RunMetadata {
  build: string;
  script_version?: string | null;
  status: string;
  teams: string[];
  seed?: number | null;
  runs?: number | null;
  n_workers?: number | null;
  export_file?: string | null;
  teaminfo_file?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  player_count?: number | null;
  config_snapshot?: Record<string, unknown> | null;
  error?: string | null;
}
