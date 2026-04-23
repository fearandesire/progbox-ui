"""Tests for api/services/runner.py with C++ adapter mocked out."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from services import engine_adapter, runner


def _patch_engine_success(monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, float, str, bool]]:
    progress_events: list[tuple[str, float, str, bool]] = []
    original_set_progress = runner.set_progress

    def recording_set_progress(build: str, phase: str, pct: float, message: str, *, done: bool = False) -> None:
        progress_events.append((phase, round(float(pct), 2), message, done))
        original_set_progress(build, phase, pct, message, done=done)

    monkeypatch.setattr(runner, "set_progress", recording_set_progress)
    monkeypatch.setattr(
        runner.cpp_adapter,
        "run_cpp_simulation",
        lambda **kwargs: 2,  # returns player_count=2
    )
    return progress_events


def test_set_progress_clamps_pct() -> None:
    runner.set_progress("20260101120000", "simulating", 999, "Too high", done=True)
    assert runner.PROGRESS["20260101120000"]["pct"] == 100.0
    runner.PROGRESS.clear()


def test_run_simulation_job_writes_metadata_and_reports_progress(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    progress_events = _patch_engine_success(monkeypatch)

    build = "20260101120000"
    run_dir = tmp_path / "outputs" / build  # isolated_outputs_dir fixture controls this
    # Use PROGBOX_OUTPUTS_DIR (already set by autouse fixture); rebuild using outputs_root
    from services.storage import outputs_root
    run_dir = outputs_root() / build
    run_dir.mkdir(parents=True, exist_ok=True)
    export_path = run_dir / "export.json"
    teaminfo_path = run_dir / "teaminfo.json"
    export_path.write_text(json.dumps({"players": []}), encoding="utf-8")
    teaminfo_path.write_text(json.dumps({"0": "BOS"}), encoding="utf-8")
    (run_dir / "metadata.json").write_text(
        json.dumps(
            {
                "build": build,
                "status": "running",
                "script_version": engine_adapter.script_version(),
                "custom_note": "keep me",
            }
        ),
        encoding="utf-8",
    )

    runner.run_simulation_job(
        build,
        export_path,
        teaminfo_path,
        teams=["BOS"],
        seed=7,
        runs=2,
        n_workers=1,
    )

    metadata = json.loads((run_dir / "metadata.json").read_text(encoding="utf-8"))
    assert metadata["build"] == build
    assert metadata["status"] == "complete"
    assert metadata["player_count"] == 2
    assert metadata["custom_note"] == "keep me"
    assert metadata["error"] is None

    assert runner.PROGRESS[build]["done"] is True
    assert runner.PROGRESS[build]["phase"] == "complete"
    assert progress_events[0][0] == "parsing"
    assert progress_events[-1] == ("complete", 100.0, "Done.", True)


def test_run_simulation_job_records_failure_and_traceback(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    progress_events: list[tuple[str, float, str, bool]] = []
    original_set_progress = runner.set_progress

    def recording_set_progress(build: str, phase: str, pct: float, message: str, *, done: bool = False) -> None:
        progress_events.append((phase, round(float(pct), 2), message, done))
        original_set_progress(build, phase, pct, message, done=done)

    monkeypatch.setattr(runner, "set_progress", recording_set_progress)
    monkeypatch.setattr(
        runner.cpp_adapter,
        "run_cpp_simulation",
        lambda **kwargs: (_ for _ in ()).throw(RuntimeError("boom")),
    )

    build = "20260101120000"
    from services.storage import outputs_root
    run_dir = outputs_root() / build
    run_dir.mkdir(parents=True, exist_ok=True)
    export_path = run_dir / "export.json"
    teaminfo_path = run_dir / "teaminfo.json"
    export_path.write_text(json.dumps({"players": []}), encoding="utf-8")
    teaminfo_path.write_text(json.dumps({"0": "BOS"}), encoding="utf-8")
    (run_dir / "metadata.json").write_text(
        json.dumps({"build": build, "status": "running"}),
        encoding="utf-8",
    )

    runner.run_simulation_job(
        build,
        export_path,
        teaminfo_path,
        teams=[],
        seed=7,
        runs=1,
        n_workers=1,
    )

    metadata = json.loads((run_dir / "metadata.json").read_text(encoding="utf-8"))
    assert metadata["status"] == "failed"
    assert metadata["error"] == "RuntimeError: boom"
    assert "Traceback" in metadata["error_detail"]
    assert runner.PROGRESS[build]["done"] is True
    assert runner.PROGRESS[build]["phase"] == "failed"
    assert progress_events[-1][0] == "failed"
