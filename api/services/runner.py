"""Run the C++ simulation pipeline in a worker thread."""

from __future__ import annotations

import json
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from services import cpp_adapter
from services.storage import outputs_root

PROGRESS: dict[str, dict[str, Any]] = {}


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def set_progress(build: str, phase: str, pct: float, message: str, *, done: bool = False) -> None:
    PROGRESS[build] = {
        "phase": phase,
        "pct": max(0.0, min(100.0, float(pct))),
        "message": message,
        "done": done,
    }


def clear_progress_later(build: str) -> None:
    """Caller may remove PROGRESS after SSE clients disconnect; optional."""
    PROGRESS.pop(build, None)


def _merge_metadata(build: str, updates: dict[str, Any]) -> None:
    out = outputs_root()
    path = out / build / "metadata.json"
    existing: dict[str, Any] = {}
    if path.is_file():
        try:
            existing = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            existing = {}
    existing.update(updates)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(existing, indent=2), encoding="utf-8")


def run_simulation_job(
    build: str,
    export_path: Path,
    teaminfo_path: Path,
    teams: list[str],
    seed: int,
    runs: int,
    n_workers: int,
) -> None:
    """Execute the full pipeline via the C++ engine adapter.

    Assumes metadata.json already exists with status running.
    """
    canonical_run_dir = outputs_root() / build
    canonical_run_dir.mkdir(parents=True, exist_ok=True)

    try:
        set_progress(build, "parsing", 2.0, "Loading export…")
        _merge_metadata(build, {"status": "running"})

        # Phase weights: parsing 0–5, simulating 5–80, saving/analyzing 80–97,
        # finalizing 97–99, complete 100.
        set_progress(build, "simulating", 5.0, f"Simulating ({runs} runs)…")

        def _on_cpp_progress(cpp_pct: float, message: str) -> None:
            ui_pct = 5.0 + (cpp_pct * 0.75)
            set_progress(build, "simulating", ui_pct, f"Simulating ({int(cpp_pct)}%)")

        _stage_map = {
            "cpp_done": (80.0, "analyzing", "Saving workbook…"),
            "artifacts_copied": (85.0, "analyzing", "Copied artifacts."),
            "analyzing": (88.0, "analyzing", "Generating analysis…"),
            "analysis_done": (97.0, "analyzing", "Analysis complete."),
        }

        def _on_post_sim_stage(stage: str, message: str) -> None:
            mapping = _stage_map.get(stage)
            if mapping is None:
                return
            pct, phase, default_msg = mapping
            set_progress(build, phase, pct, message or default_msg)

        player_count = cpp_adapter.run_cpp_simulation(
            export_path=export_path,
            teaminfo_path=teaminfo_path,
            teams=teams,
            seed=seed,
            runs=runs,
            n_workers=n_workers,
            canonical_run_dir=canonical_run_dir,
            progress_callback=_on_cpp_progress,
            stage_callback=_on_post_sim_stage,
        )

        set_progress(build, "finalizing", 99.0, "Writing metadata…")
        _merge_metadata(
            build,
            {
                "status": "complete",
                "completed_at": _utc_now_iso(),
                "player_count": player_count,
                "error": None,
            },
        )
        set_progress(build, "complete", 100.0, "Done.", done=True)
    except Exception as exc:  # noqa: BLE001 — surface engine failures to metadata
        err = f"{type(exc).__name__}: {exc}"
        tb = traceback.format_exc()
        _merge_metadata(
            build,
            {
                "status": "failed",
                "completed_at": _utc_now_iso(),
                "error": err,
            },
        )
        set_progress(build, "failed", 0.0, err, done=True)
        _merge_metadata(build, {"error_detail": tb[:8000]})
