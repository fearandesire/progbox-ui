from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import pandas as pd
import pytest

from progutils import Config
from services import engine_adapter, runner


def _initial_frame() -> pd.DataFrame:
    rows = []
    for idx, (name, team, age) in enumerate(
        [
            ("Alpha One", "BOS", 29),
            ("Beta Two", "NYK", 33),
        ]
    ):
        row = {
            "Name": name,
            "Team": team,
            "Age": age,
            "PER": 18.5 + idx,
            "DWS": 2.4 - idx * 0.2,
            "EWA": 1.2 + idx * 0.1,
        }
        row.update({attr: 50 + idx for attr in Config.ALL_ATTRS})
        rows.append(row)
    return pd.DataFrame(rows, index=[101, 102])


class FakeRunsim:
    def __init__(self, seed: int) -> None:
        self.seed = seed
        self.analytics = None

    def PROGEMUP(self, initial_df: pd.DataFrame, runs: int, output_dir: str, n_workers: int) -> pd.DataFrame:  # noqa: N802
        records: list[dict[str, object]] = []
        for run in range(runs):
            for player_id, (_, row) in enumerate(initial_df.iterrows()):
                record: dict[str, object] = {
                    "Run": run,
                    "RunSeed": 1000 + run,
                    "PlayerID": player_id,
                    "Name": row["Name"],
                    "Team": row["Team"],
                    "Age": row["Age"],
                    "Baseline": 55 + player_id,
                    "Ovr": 56 + run + player_id,
                    "Delta": 1.0 + player_id,
                    "PctChange": 0.1 + (player_id * 0.01),
                    "AboveBaseline": True,
                    "PER": row["PER"],
                    "DWS": row["DWS"],
                    "EWA": row["EWA"],
                }
                for attr in Config.ALL_ATTRS:
                    record[attr] = row[attr]
                records.append(record)
        return pd.DataFrame(records)


def _patch_repo_root(monkeypatch: pytest.MonkeyPatch, repo_root: Path) -> None:
    monkeypatch.setattr(runner, "repo_root", lambda: repo_root)


def _patch_engine_success(monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, float, str, bool]]:
    progress_events: list[tuple[str, float, str, bool]] = []
    original_set_progress = runner.set_progress

    def recording_set_progress(build: str, phase: str, pct: float, message: str, *, done: bool = False) -> None:
        progress_events.append((phase, round(float(pct), 2), message, done))
        original_set_progress(build, phase, pct, message, done=done)

    monkeypatch.setattr(runner, "set_progress", recording_set_progress)
    monkeypatch.setattr(
        runner.engine_adapter,
        "load_exportcleaner_module",
        lambda: SimpleNamespace(
            exportcleaner=lambda export_file, teams, teaminfo_file: (
                _initial_frame(),
                {"league_name": "Fixture League"},
            )
        ),
    )
    monkeypatch.setattr(runner.engine_adapter, "load_runsim_class", lambda: FakeRunsim)
    monkeypatch.setattr(
        runner.engine_adapter,
        "load_analysis_module",
        lambda: SimpleNamespace(
            generate_analysis=lambda run_dir: (Path(run_dir) / "analysis.xlsx").write_bytes(b"fake-xlsx")
        ),
    )
    return progress_events


def test_set_progress_clamps_pct() -> None:
    runner.set_progress("20260101120000", "simulating", 999, "Too high", done=True)
    assert runner.PROGRESS["20260101120000"]["pct"] == 100.0
    runner.PROGRESS.clear()


def test_run_simulation_job_writes_artifacts_and_merges_metadata(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    repo_root = tmp_path
    (repo_root / "data").mkdir(parents=True, exist_ok=True)
    _patch_repo_root(monkeypatch, repo_root)
    progress_events = _patch_engine_success(monkeypatch)

    build = "20260101120000"
    run_dir = repo_root / "outputs" / build
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
    assert metadata["script_version"] == engine_adapter.script_version()
    assert metadata["player_count"] == 2
    assert metadata["custom_note"] == "keep me"
    assert metadata["error"] is None

    outputs_csv = run_dir / "raw" / "outputs.csv"
    analysis_xlsx = run_dir / "analysis.xlsx"
    assert outputs_csv.is_file()
    assert analysis_xlsx.is_file()
    assert outputs_csv.stat().st_size > 0
    assert analysis_xlsx.stat().st_size > 0

    assert runner.PROGRESS[build]["done"] is True
    assert runner.PROGRESS[build]["phase"] == "complete"
    assert progress_events[0][0] == "parsing"
    assert progress_events[-1] == ("complete", 100.0, "Done.", True)


def test_run_simulation_job_records_failure_and_traceback(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    repo_root = tmp_path
    (repo_root / "data").mkdir(parents=True, exist_ok=True)
    _patch_repo_root(monkeypatch, repo_root)

    progress_events: list[tuple[str, float, str, bool]] = []
    original_set_progress = runner.set_progress

    def recording_set_progress(build: str, phase: str, pct: float, message: str, *, done: bool = False) -> None:
        progress_events.append((phase, round(float(pct), 2), message, done))
        original_set_progress(build, phase, pct, message, done=done)

    monkeypatch.setattr(runner, "set_progress", recording_set_progress)
    monkeypatch.setattr(
        runner.engine_adapter,
        "load_exportcleaner_module",
        lambda: SimpleNamespace(
            exportcleaner=lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("boom"))
        ),
    )

    build = "20260101120000"
    run_dir = repo_root / "outputs" / build
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
    assert not (run_dir / "analysis.xlsx").exists()
