export type TeaminfoSource = "generated" | "user";

export interface RunMetadata {
  build: string;
  /** Executed progression script (name/id), patched from the engine post-run. */
  script_version?: string | null;
  /** Version requested at run-creation time (`v41` | `v43`). */
  requested_version?: string | null;
  /** Progression the engine actually ran. */
  progression?: { id: string | null; name: string | null } | null;
  /** Engine binary build id (from vendored VERSION) — distinct from the script version. */
  engine_build?: string | null;
  /** Which analysis path produced the dashboard: real Python or the stub fallback. */
  analysis_engine?: "python" | "fallback" | null;
  status: string;
  teams: string[];
  seed?: number | null;
  runs?: number | null;
  n_workers?: number | null;
  year?: number | null;
  export_file?: string | null;
  export_title?: string | null;
  teaminfo_file?: string | null;
  teaminfo_source?: TeaminfoSource;
  started_at?: string | null;
  completed_at?: string | null;
  player_count?: number | null;
  /** Legacy: pre-integration runs may still carry a hardcoded config snapshot. */
  config_snapshot?: Record<string, unknown> | null;
  error?: string | null;
  error_detail?: string | null;
  /** Shared id linking the two runs of an auto-comparison pair. */
  pair_id?: string | null;
  /** This run's role within its auto-comparison pair. */
  pair_role?: "primary" | "baseline" | null;
  /** The sibling run's build id within the pair. */
  paired_with?: string | null;
}

export interface SimProgressPayload {
  phase: string;
  pct: number;
  message: string;
  done: boolean;
}
