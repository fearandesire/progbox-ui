"""C++ engine smoke test.

Marked @engine so it is excluded from regular `pytest` runs and only
executed via `pnpm test:api:engine`. Requires the C++ binary to be built
(`pnpm build:engine`) or PROGBOX_CPP_BINARY to point to a pre-built binary.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pandas as pd
import pytest

from services import cpp_adapter, engine_adapter, runner


pytestmark = pytest.mark.engine


def test_cpp_engine_smoke_run(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    sample_export_payload: dict[str, object],
    sample_teaminfo: dict[str, str],
    write_json,
) -> None:
    """Full smoke run with the compiled C++ binary."""
    repo_root = tmp_path / "repo"
    repo_root.mkdir(parents=True, exist_ok=True)
    (repo_root / "data").mkdir(parents=True, exist_ok=True)
    monkeypatch.setenv("PROGBOX_OUTPUTS_DIR", str(repo_root / "outputs"))
    monkeypatch.setattr(runner, "repo_root", lambda: repo_root)
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

    build = "20260101120000"
    run_dir = repo_root / "outputs" / build
    run_dir.mkdir(parents=True, exist_ok=True)

    export_path = write_json(run_dir / "export.json", sample_export_payload)
    teaminfo_path = write_json(run_dir / "teaminfo.json", sample_teaminfo)
    write_json(
        run_dir / "metadata.json",
        {
            "build": build,
            "status": "running",
            "script_version": engine_adapter.script_version(),
            "teams": [],
        },
    )

    runner.run_simulation_job(
        build,
        export_path,
        teaminfo_path,
        teams=[],
        seed=69,
        runs=2,
        n_workers=1,
    )

    metadata = json.loads((run_dir / "metadata.json").read_text(encoding="utf-8"))
    assert metadata["build"] == build
    assert metadata["status"] == "complete"
    assert metadata["script_version"] == engine_adapter.script_version()
    assert metadata["player_count"] == len(sample_export_payload["players"])
    assert metadata["error"] is None

    outputs_csv = run_dir / "raw" / "outputs.csv"
    analysis_xlsx = run_dir / "analysis.xlsx"
    charts_dir = run_dir / "charts"
    assert outputs_csv.is_file()
    assert analysis_xlsx.is_file()
    assert charts_dir.is_dir()
    assert any(charts_dir.glob("*.png"))
    assert outputs_csv.stat().st_size > 0
    assert analysis_xlsx.stat().st_size > 0

    # C++ CSV has no leading index column; Run is column 0
    df = pd.read_csv(outputs_csv)
    assert "Unnamed: 0" not in df.columns
    assert "Run" in df.columns
    assert df["Run"].nunique() == 2
    assert df["PlayerID"].nunique() == len(sample_export_payload["players"])
    assert len(df) == 2 * len(sample_export_payload["players"])


def test_cpp_engine_team_filter_smoke(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    sample_export_payload: dict[str, object],
    sample_teaminfo: dict[str, str],
    write_json,
) -> None:
    """Smoke run with teams=["BOS"] — only BOS rows should appear in outputs."""
    repo_root = tmp_path / "repo_bos"
    repo_root.mkdir(parents=True, exist_ok=True)
    (repo_root / "data").mkdir(parents=True, exist_ok=True)
    monkeypatch.setenv("PROGBOX_OUTPUTS_DIR", str(repo_root / "outputs"))
    monkeypatch.setattr(runner, "repo_root", lambda: repo_root)
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

    build = "20260201120000"
    run_dir = repo_root / "outputs" / build
    run_dir.mkdir(parents=True, exist_ok=True)

    export_path = write_json(run_dir / "export.json", sample_export_payload)
    teaminfo_path = write_json(run_dir / "teaminfo.json", sample_teaminfo)
    write_json(
        run_dir / "metadata.json",
        {
            "build": build,
            "status": "running",
            "script_version": engine_adapter.script_version(),
            "teams": ["BOS"],
        },
    )

    runner.run_simulation_job(
        build,
        export_path,
        teaminfo_path,
        teams=["BOS"],
        seed=99,
        runs=2,
        n_workers=1,
    )

    metadata = json.loads((run_dir / "metadata.json").read_text(encoding="utf-8"))
    assert metadata["status"] == "complete"
    assert metadata["error"] is None

    df = pd.read_csv(run_dir / "raw" / "outputs.csv")
    assert set(df["Team"].unique()) == {"BOS"}
