"""Run the C++ simulation pipeline in a worker thread."""

from __future__ import annotations

import json
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from services import cpp_adapter, engine_adapter
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

        set_progress(build, "parsing", 5.0, "Preparing inputs…")

        # Phase weights: parsing 0–5, simulating 5–85, analyzing 85–100
        set_progress(build, "simulating", 5.0, f"Simulating ({runs} runs)…")

        player_count = cpp_adapter.run_cpp_simulation(
            build=build,
            export_path=export_path,
            teaminfo_path=teaminfo_path,
            teams=teams,
            seed=seed,
            runs=runs,
            n_workers=n_workers,
            canonical_run_dir=canonical_run_dir,
        )

        set_progress(build, "simulating", 85.0, "Simulation complete.")
        set_progress(build, "analyzing", 85.0, "Analysis complete.")

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
