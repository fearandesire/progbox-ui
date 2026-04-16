"""Run exportcleaner → runsim.PROGEMUP → analysis.generate_analysis in a worker thread."""

from __future__ import annotations

import json
import os
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from services import engine_adapter
from services.storage import outputs_root, repo_root

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
    """
    Execute the full pipeline. Assumes metadata.json already exists with status running.
    Uses repo root as cwd so exportcleaner/analysis relative paths match upstream.
    """
    REPO_ROOT = repo_root()
    raw_dir = REPO_ROOT / "outputs" / build / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)

    runsim_cls = engine_adapter.load_runsim_class()
    exportcleaner = engine_adapter.load_exportcleaner_module().exportcleaner
    generate_analysis = engine_adapter.load_analysis_module().generate_analysis

    prev_cwd = os.getcwd()
    try:
        os.chdir(REPO_ROOT)

        set_progress(build, "parsing", 2.0, "Loading export…")
        _merge_metadata(build, {"status": "running"})

        # Phase weights: parsing 0–5, simulating 5–85, analyzing 85–100
        set_progress(build, "parsing", 5.0, "Cleaning export…")
        data, _league_meta = exportcleaner(
            export_file=str(export_path.resolve()),
            teams=teams,
            teaminfo_file=str(teaminfo_path.resolve()),
        )
        player_count = int(len(data))

        set_progress(build, "simulating", 5.0, f"Simulating ({runs} runs)…")
        sim = runsim_cls(seed=seed)
        output_dir = raw_dir.resolve()
        df = sim.PROGEMUP(
            data,
            runs=runs,
            output_dir=str(output_dir),
            n_workers=n_workers,
        )
        csv_path = output_dir / "outputs.csv"
        df.to_csv(csv_path)
        if sim.analytics:
            sim.analytics.print_report()

        set_progress(build, "simulating", 85.0, "Simulation complete.")
        set_progress(build, "analyzing", 85.0, "Generating analysis…")
        generate_analysis(str(REPO_ROOT / "outputs" / build))
        set_progress(build, "analyzing", 100.0, "Analysis complete.")

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
        # Preserve traceback for operators
        _merge_metadata(build, {"error_detail": tb[:8000]})
    finally:
        try:
            os.chdir(prev_cwd)
        except OSError:
            pass
