"""Unit tests for api/services/cpp_adapter.py.

All tests mock subprocess.run and filesystem so no compiled binary is required.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pandas as pd
import pytest

from services import cpp_adapter, engine_adapter


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _make_fake_export(path: Path, players: list[dict]) -> None:
    path.write_text(json.dumps({"players": players}), encoding="utf-8")


def _make_fake_teaminfo(path: Path) -> None:
    path.write_text(json.dumps({"0": "BOS", "1": "NYK"}), encoding="utf-8")


def _make_fake_cpp_outputs(base: Path, run_id: str = "20260101120001") -> Path:
    """Simulate what the C++ binary writes: base/<timestamp>/raw/*.csv + metadata.json."""
    cpp_dir = base / run_id
    raw_dir = cpp_dir / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)
    (raw_dir / "outputs.csv").write_text(
        "Run,RunSeed,Name,Team,Age,PlayerID,Baseline,Ovr,Delta,PctChange,"
        "AboveBaseline,PER,DWS,EWA,dIQ,Dnk,Drb,End,2Pt,FT,Ins,Jmp,"
        "oIQ,Pss,Reb,Spd,Str,3Pt,Hgt\n"
        "0,12345,Alpha One,BOS,29,0,55.0,56.0,1.0,0.018182,True,"
        "18.5,2.4,1.2,54,50,51,52,53,54,55,56,57,58,59,60,61,62,63\n",
        encoding="utf-8",
    )
    (raw_dir / "godprogs.json").write_text("[]", encoding="utf-8")
    (raw_dir / "superlucky.json").write_text("{}", encoding="utf-8")
    (cpp_dir / "metadata.json").write_text(
        json.dumps({"build_id": run_id, "simulation": {"runs": 1}}),
        encoding="utf-8",
    )
    return cpp_dir


# ─────────────────────────────────────────────────────────────────────────────
# _resolve_binary
# ─────────────────────────────────────────────────────────────────────────────

def test_resolve_binary_uses_env_override(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    fake_binary = tmp_path / "fake_progbox"
    fake_binary.write_bytes(b"")
    monkeypatch.setenv("PROGBOX_CPP_BINARY", str(fake_binary))
    assert cpp_adapter._resolve_binary() == fake_binary


def test_resolve_binary_env_override_missing_raises(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PROGBOX_CPP_BINARY", str(tmp_path / "nonexistent"))
    with pytest.raises(FileNotFoundError, match="PROGBOX_CPP_BINARY"):
        cpp_adapter._resolve_binary()


def test_resolve_binary_finds_candidate(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("PROGBOX_CPP_BINARY", raising=False)
    fake_bin = tmp_path / "progbox"
    fake_bin.write_bytes(b"")
    monkeypatch.setattr(cpp_adapter, "_BINARY_CANDIDATES", [tmp_path / "nope", fake_bin])
    assert cpp_adapter._resolve_binary() == fake_bin


def test_resolve_binary_no_candidates_raises(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("PROGBOX_CPP_BINARY", raising=False)
    monkeypatch.setattr(cpp_adapter, "_BINARY_CANDIDATES", [tmp_path / "nope"])
    with pytest.raises(FileNotFoundError, match="pnpm build:engine"):
        cpp_adapter._resolve_binary()


# ─────────────────────────────────────────────────────────────────────────────
# _filter_export
# ─────────────────────────────────────────────────────────────────────────────

def test_filter_export_no_teams_returns_all(tmp_path: Path) -> None:
    export = tmp_path / "export.json"
    teaminfo = tmp_path / "teaminfo.json"
    _make_fake_export(export, [{"pid": 0, "tid": 0}, {"pid": 1, "tid": 1}])
    _make_fake_teaminfo(teaminfo)
    data = cpp_adapter._filter_export(export, teaminfo, [])
    assert len(data["players"]) == 2


def test_filter_export_filters_by_team(tmp_path: Path) -> None:
    export = tmp_path / "export.json"
    teaminfo = tmp_path / "teaminfo.json"
    _make_fake_export(export, [{"pid": 0, "tid": 0}, {"pid": 1, "tid": 1}])
    _make_fake_teaminfo(teaminfo)
    data = cpp_adapter._filter_export(export, teaminfo, ["BOS"])
    assert len(data["players"]) == 1
    assert data["players"][0]["tid"] == 0


def test_filter_export_unknown_team_yields_empty(tmp_path: Path) -> None:
    export = tmp_path / "export.json"
    teaminfo = tmp_path / "teaminfo.json"
    _make_fake_export(export, [{"pid": 0, "tid": 0}])
    _make_fake_teaminfo(teaminfo)
    data = cpp_adapter._filter_export(export, teaminfo, ["LAL"])
    assert data["players"] == []


# ─────────────────────────────────────────────────────────────────────────────
# _find_cpp_output_dir
# ─────────────────────────────────────────────────────────────────────────────

def test_find_cpp_output_dir_single_subdir(tmp_path: Path) -> None:
    (tmp_path / "20260101120001").mkdir()
    result = cpp_adapter._find_cpp_output_dir(tmp_path)
    assert result.name == "20260101120001"


def test_find_cpp_output_dir_multiple_raises(tmp_path: Path) -> None:
    (tmp_path / "20260101120001").mkdir()
    (tmp_path / "20260101120002").mkdir()
    with pytest.raises(RuntimeError, match="Expected exactly 1"):
        cpp_adapter._find_cpp_output_dir(tmp_path)


def test_find_cpp_output_dir_none_raises(tmp_path: Path) -> None:
    with pytest.raises(RuntimeError, match="Expected exactly 1"):
        cpp_adapter._find_cpp_output_dir(tmp_path)


# ─────────────────────────────────────────────────────────────────────────────
# run_cpp_simulation — command construction and artifact copying
# ─────────────────────────────────────────────────────────────────────────────

def _make_fake_exportcleaner(player_count: int) -> object:
    rows = [
        {
            "Name": f"Player {i}",
            "Team": "BOS",
            "Age": 29,
            "PER": 18.0,
            "DWS": 2.0,
            "EWA": 1.0,
            **{a: 50 for a in ["dIQ", "Dnk", "Drb", "End", "2Pt", "FT", "Ins",
                                "Jmp", "oIQ", "Pss", "Reb", "Spd", "Str", "3Pt", "Hgt"]},
        }
        for i in range(player_count)
    ]
    df = pd.DataFrame(rows)

    def fake_exportcleaner(export_file, teams, teaminfo_file):
        return df, {"league_name": "Test"}

    return SimpleNamespace(exportcleaner=fake_exportcleaner)


def _patch_run_cpp(monkeypatch: pytest.MonkeyPatch, tmp_path: Path, fake_binary: Path) -> list[list[str]]:
    """Patch subprocess.run so it creates the C++ output structure without running C++."""
    captured_cmds: list[list[str]] = []

    def fake_subprocess_run(cmd, **kwargs):
        captured_cmds.append(list(cmd))
        # Simulate C++ binary creating a timestamped output dir
        cpp_outputs_base = None
        for arg in cmd:
            if "_cpp_tmp_outputs" in str(arg):
                cpp_outputs_base = Path(arg)
                break
        if cpp_outputs_base and cpp_outputs_base.exists():
            _make_fake_cpp_outputs(cpp_outputs_base)
        return subprocess.CompletedProcess(cmd, 0)

    monkeypatch.setattr(subprocess, "run", fake_subprocess_run)
    monkeypatch.setattr(
        engine_adapter, "load_exportcleaner_module",
        lambda: _make_fake_exportcleaner(2),
    )
    monkeypatch.setattr(cpp_adapter, "_resolve_binary", lambda: fake_binary)
    monkeypatch.setattr(cpp_adapter, "_ANALYSIS_SCRIPT", fake_binary)  # also skip real analysis
    return captured_cmds


def test_run_cpp_simulation_command_flags(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    fake_binary = tmp_path / "progbox"
    fake_binary.write_bytes(b"")
    export_path = tmp_path / "export.json"
    teaminfo_path = tmp_path / "teaminfo.json"
    _make_fake_export(export_path, [{"pid": 0, "tid": 0}])
    _make_fake_teaminfo(teaminfo_path)
    canonical_run_dir = tmp_path / "outputs" / "20260101120000"
    canonical_run_dir.mkdir(parents=True, exist_ok=True)

    captured = _patch_run_cpp(monkeypatch, tmp_path, fake_binary)

    cpp_adapter.run_cpp_simulation(
        build="20260101120000",
        export_path=export_path,
        teaminfo_path=teaminfo_path,
        teams=[],
        seed=42,
        runs=5,
        n_workers=2,
        canonical_run_dir=canonical_run_dir,
    )

    cpp_cmd = captured[0]
    assert "-v" in cpp_cmd and "v41" in cpp_cmd
    assert "-r" in cpp_cmd and "5" in cpp_cmd
    assert "-w" in cpp_cmd and "2" in cpp_cmd
    assert "-s" in cpp_cmd and "42" in cpp_cmd
    assert "-y" in cpp_cmd and "2021" in cpp_cmd


def test_run_cpp_simulation_copies_raw_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    fake_binary = tmp_path / "progbox"
    fake_binary.write_bytes(b"")
    export_path = tmp_path / "export.json"
    teaminfo_path = tmp_path / "teaminfo.json"
    _make_fake_export(export_path, [{"pid": 0, "tid": 0}])
    _make_fake_teaminfo(teaminfo_path)
    canonical_run_dir = tmp_path / "outputs" / "20260101120000"
    canonical_run_dir.mkdir(parents=True, exist_ok=True)

    _patch_run_cpp(monkeypatch, tmp_path, fake_binary)

    cpp_adapter.run_cpp_simulation(
        build="20260101120000",
        export_path=export_path,
        teaminfo_path=teaminfo_path,
        teams=[],
        seed=1,
        runs=2,
        n_workers=1,
        canonical_run_dir=canonical_run_dir,
    )

    assert (canonical_run_dir / "raw" / "outputs.csv").is_file()
    assert (canonical_run_dir / "raw" / "godprogs.json").is_file()


def test_run_cpp_simulation_preserves_engine_metadata(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    fake_binary = tmp_path / "progbox"
    fake_binary.write_bytes(b"")
    export_path = tmp_path / "export.json"
    teaminfo_path = tmp_path / "teaminfo.json"
    _make_fake_export(export_path, [{"pid": 0, "tid": 0}])
    _make_fake_teaminfo(teaminfo_path)
    canonical_run_dir = tmp_path / "outputs" / "20260101120000"
    canonical_run_dir.mkdir(parents=True, exist_ok=True)

    _patch_run_cpp(monkeypatch, tmp_path, fake_binary)

    cpp_adapter.run_cpp_simulation(
        build="20260101120000",
        export_path=export_path,
        teaminfo_path=teaminfo_path,
        teams=[],
        seed=1,
        runs=2,
        n_workers=1,
        canonical_run_dir=canonical_run_dir,
    )

    meta_path = canonical_run_dir / "engine_metadata.json"
    assert meta_path.is_file()
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    assert "simulation" in meta


def test_run_cpp_simulation_team_filter_writes_filtered_export(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    fake_binary = tmp_path / "progbox"
    fake_binary.write_bytes(b"")
    export_path = tmp_path / "export.json"
    teaminfo_path = tmp_path / "teaminfo.json"
    _make_fake_export(
        export_path,
        [{"pid": 0, "tid": 0}, {"pid": 1, "tid": 1}],
    )
    _make_fake_teaminfo(teaminfo_path)
    canonical_run_dir = tmp_path / "outputs" / "20260101120000"
    canonical_run_dir.mkdir(parents=True, exist_ok=True)

    captured = _patch_run_cpp(monkeypatch, tmp_path, fake_binary)

    cpp_adapter.run_cpp_simulation(
        build="20260101120000",
        export_path=export_path,
        teaminfo_path=teaminfo_path,
        teams=["BOS"],
        seed=1,
        runs=2,
        n_workers=1,
        canonical_run_dir=canonical_run_dir,
    )

    # The filtered export path (not the original) should be passed to C++
    cpp_cmd = captured[0]
    assert "export_filtered.json" in cpp_cmd[1]


def test_run_cpp_simulation_returns_player_count(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    fake_binary = tmp_path / "progbox"
    fake_binary.write_bytes(b"")
    export_path = tmp_path / "export.json"
    teaminfo_path = tmp_path / "teaminfo.json"
    _make_fake_export(export_path, [{"pid": 0, "tid": 0}])
    _make_fake_teaminfo(teaminfo_path)
    canonical_run_dir = tmp_path / "outputs" / "20260101120000"
    canonical_run_dir.mkdir(parents=True, exist_ok=True)

    _patch_run_cpp(monkeypatch, tmp_path, fake_binary)

    count = cpp_adapter.run_cpp_simulation(
        build="20260101120000",
        export_path=export_path,
        teaminfo_path=teaminfo_path,
        teams=[],
        seed=1,
        runs=2,
        n_workers=1,
        canonical_run_dir=canonical_run_dir,
    )

    assert count == 2  # _make_fake_exportcleaner always returns 2 rows


def test_run_cpp_simulation_nonzero_exit_raises(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    fake_binary = tmp_path / "progbox"
    fake_binary.write_bytes(b"")
    export_path = tmp_path / "export.json"
    teaminfo_path = tmp_path / "teaminfo.json"
    _make_fake_export(export_path, [{"pid": 0, "tid": 0}])
    _make_fake_teaminfo(teaminfo_path)
    canonical_run_dir = tmp_path / "outputs" / "20260101120000"
    canonical_run_dir.mkdir(parents=True, exist_ok=True)

    monkeypatch.setattr(
        engine_adapter, "load_exportcleaner_module",
        lambda: _make_fake_exportcleaner(1),
    )
    monkeypatch.setattr(cpp_adapter, "_resolve_binary", lambda: fake_binary)
    monkeypatch.setattr(cpp_adapter, "_ANALYSIS_SCRIPT", fake_binary)

    def failing_subprocess(cmd, **kwargs):
        return subprocess.CompletedProcess(cmd, 1)

    monkeypatch.setattr(subprocess, "run", failing_subprocess)

    with pytest.raises(RuntimeError, match="exited with code 1"):
        cpp_adapter.run_cpp_simulation(
            build="20260101120000",
            export_path=export_path,
            teaminfo_path=teaminfo_path,
            teams=[],
            seed=1,
            runs=2,
            n_workers=1,
            canonical_run_dir=canonical_run_dir,
        )


def test_run_cpp_simulation_cleans_up_tmp_outputs(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    fake_binary = tmp_path / "progbox"
    fake_binary.write_bytes(b"")
    export_path = tmp_path / "export.json"
    teaminfo_path = tmp_path / "teaminfo.json"
    _make_fake_export(export_path, [{"pid": 0, "tid": 0}])
    _make_fake_teaminfo(teaminfo_path)
    canonical_run_dir = tmp_path / "outputs" / "20260101120000"
    canonical_run_dir.mkdir(parents=True, exist_ok=True)

    _patch_run_cpp(monkeypatch, tmp_path, fake_binary)

    cpp_adapter.run_cpp_simulation(
        build="20260101120000",
        export_path=export_path,
        teaminfo_path=teaminfo_path,
        teams=[],
        seed=1,
        runs=2,
        n_workers=1,
        canonical_run_dir=canonical_run_dir,
    )

    assert not (canonical_run_dir / "_cpp_tmp_outputs").exists()
