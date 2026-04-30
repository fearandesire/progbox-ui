"""Unit tests for api/services/cpp_adapter.py.

All tests mock subprocess.run and filesystem so no compiled binary is required.
"""

from __future__ import annotations

import json
import subprocess
from collections.abc import Callable
from pathlib import Path
from types import SimpleNamespace

import pandas as pd
import pytest

from services import cpp_adapter, engine_adapter


# ─────────────────────────────────────────────────────────────────────────────
# Helpers / fixtures
# ─────────────────────────────────────────────────────────────────────────────

_TEAMINFO = {"0": "BOS", "1": "NYK"}


def _make_fake_export(path: Path, players: list[dict]) -> None:
    path.write_text(json.dumps({"players": players}), encoding="utf-8")


def _make_fake_teaminfo(path: Path) -> None:
    path.write_text(json.dumps(_TEAMINFO), encoding="utf-8")


def _make_fake_cpp_outputs(base: Path, run_id: str = "20260101120001") -> Path:
    """Simulate the C++ binary's output: base/<timestamp>/raw/* + metadata.json."""
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


def _fake_exportcleaner_module(player_count: int) -> object:
    rows = [
        {
            "Name": f"Player {i}", "Team": "BOS", "Age": 29,
            "PER": 18.0, "DWS": 2.0, "EWA": 1.0,
            **{a: 50 for a in ["dIQ", "Dnk", "Drb", "End", "2Pt", "FT", "Ins",
                               "Jmp", "oIQ", "Pss", "Reb", "Spd", "Str", "3Pt", "Hgt"]},
        }
        for i in range(player_count)
    ]
    df = pd.DataFrame(rows)

    def fake_exportcleaner(export_file, teams, teaminfo_file):
        return df, {"league_name": "Test"}

    return SimpleNamespace(exportcleaner=fake_exportcleaner)


@pytest.fixture
def cpp_sim_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> SimpleNamespace:
    """Patched environment for `run_cpp_simulation` tests.

    Returns a namespace with `binary`, `export`, `teaminfo`, `run_dir`,
    `captured_cmds`, and a `run(**overrides)` callable that invokes
    `run_cpp_simulation` with sane defaults.
    """
    binary = tmp_path / "progbox"
    binary.write_bytes(b"")
    export_path = tmp_path / "export.json"
    teaminfo_path = tmp_path / "teaminfo.json"
    _make_fake_export(export_path, [{"pid": 0, "tid": 0}, {"pid": 1, "tid": 1}])
    _make_fake_teaminfo(teaminfo_path)
    run_dir = tmp_path / "outputs" / "20260101120000"
    run_dir.mkdir(parents=True, exist_ok=True)

    captured: list[list[str]] = []

    def fake_subprocess_run(cmd, **_kwargs):
        captured.append(list(cmd))
        for arg in cmd:
            if "_cpp_tmp_outputs" in str(arg) and Path(arg).exists():
                _make_fake_cpp_outputs(Path(arg))
                break
        return subprocess.CompletedProcess(cmd, 0)

    monkeypatch.setattr(subprocess, "run", fake_subprocess_run)
    monkeypatch.setattr(
        engine_adapter, "load_exportcleaner_module",
        lambda: _fake_exportcleaner_module(2),
    )
    monkeypatch.setattr(cpp_adapter, "_resolve_binary", lambda: binary)
    monkeypatch.setattr(cpp_adapter, "_ANALYSIS_SCRIPT", binary)  # skip real analysis

    def run(**overrides):
        kwargs = dict(
            export_path=export_path, teaminfo_path=teaminfo_path,
            teams=[], seed=1, runs=2, n_workers=1,
            canonical_run_dir=run_dir,
        )
        kwargs.update(overrides)
        return cpp_adapter.run_cpp_simulation(**kwargs)

    return SimpleNamespace(
        binary=binary, export=export_path, teaminfo=teaminfo_path,
        run_dir=run_dir, captured=captured, run=run,
    )


# ─────────────────────────────────────────────────────────────────────────────
# _resolve_binary
# ─────────────────────────────────────────────────────────────────────────────

def test_resolve_binary_uses_env_override(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    fake_binary = tmp_path / "fake_progbox"
    fake_binary.write_bytes(b"")
    monkeypatch.setenv("PROGBOX_CPP_BINARY", str(fake_binary))
    assert cpp_adapter._resolve_binary() == fake_binary


def test_resolve_binary_finds_candidate(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("PROGBOX_CPP_BINARY", raising=False)
    fake_bin = tmp_path / "progbox"
    fake_bin.write_bytes(b"")
    monkeypatch.setattr(cpp_adapter, "_BINARY_CANDIDATES", [tmp_path / "nope", fake_bin])
    assert cpp_adapter._resolve_binary() == fake_bin


@pytest.mark.parametrize(
    ("setup", "match"),
    [
        (
            lambda tmp, mp: mp.setenv("PROGBOX_CPP_BINARY", str(tmp / "nonexistent")),
            "PROGBOX_CPP_BINARY",
        ),
        (
            lambda tmp, mp: (
                mp.delenv("PROGBOX_CPP_BINARY", raising=False),
                mp.setattr(cpp_adapter, "_BINARY_CANDIDATES", [tmp / "nope"]),
            ),
            "pnpm build:engine",
        ),
    ],
    ids=["env-override-missing", "no-candidates"],
)
def test_resolve_binary_missing_raises(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    setup: Callable[[Path, pytest.MonkeyPatch], object],
    match: str,
) -> None:
    setup(tmp_path, monkeypatch)
    with pytest.raises(FileNotFoundError, match=match):
        cpp_adapter._resolve_binary()


# ─────────────────────────────────────────────────────────────────────────────
# _filter_export
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize(
    ("teams", "expected_tids"),
    [([], [0, 1]), (["BOS"], [0]), (["LAL"], [])],
    ids=["no-filter", "known-team", "unknown-team"],
)
def test_filter_export(tmp_path: Path, teams: list[str], expected_tids: list[int]) -> None:
    export = tmp_path / "export.json"
    teaminfo = tmp_path / "teaminfo.json"
    _make_fake_export(export, [{"pid": 0, "tid": 0}, {"pid": 1, "tid": 1}])
    _make_fake_teaminfo(teaminfo)
    data = cpp_adapter._filter_export(export, teaminfo, teams)
    assert [p["tid"] for p in data["players"]] == expected_tids


# ─────────────────────────────────────────────────────────────────────────────
# _find_cpp_output_dir
# ─────────────────────────────────────────────────────────────────────────────

def test_find_cpp_output_dir_single_subdir(tmp_path: Path) -> None:
    (tmp_path / "20260101120001").mkdir()
    assert cpp_adapter._find_cpp_output_dir(tmp_path).name == "20260101120001"


@pytest.mark.parametrize("n_subdirs", [0, 2], ids=["none", "multiple"])
def test_find_cpp_output_dir_wrong_count_raises(tmp_path: Path, n_subdirs: int) -> None:
    for i in range(n_subdirs):
        (tmp_path / f"2026010112000{i}").mkdir()
    with pytest.raises(RuntimeError, match="Expected exactly 1"):
        cpp_adapter._find_cpp_output_dir(tmp_path)


# ─────────────────────────────────────────────────────────────────────────────
# season normalization
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize(
    ("raw_season", "expected"),
    [
        (2024, 2024),
        ("2025", 2025),
        (None, 2021),
        ("playoffs", 2021),
    ],
    ids=["int", "numeric-string", "none", "nonnumeric-string"],
)
def test_get_season_normalizes_invalid_values(
    tmp_path: Path,
    raw_season: object,
    expected: int,
) -> None:
    export = tmp_path / "export.json"
    export.write_text(
        json.dumps({"gameAttributes": {"season": raw_season}, "players": []}),
        encoding="utf-8",
    )

    assert cpp_adapter._get_season(export) == expected


# run_cpp_simulation
# ─────────────────────────────────────────────────────────────────────────────

def test_run_cpp_simulation_passes_flags(cpp_sim_env: SimpleNamespace) -> None:
    cpp_sim_env.run(seed=42, runs=5, n_workers=2)
    cmd = cpp_sim_env.captured[0]
    # Flags arrive as ordered (-flag, value) pairs after the three positional args.
    flag_pairs = list(zip(cmd[4::2], cmd[5::2]))
    assert ("-v", "v41") in flag_pairs
    assert ("-r", "5") in flag_pairs
    assert ("-w", "2") in flag_pairs
    assert ("-s", "42") in flag_pairs
    assert ("-y", "2021") in flag_pairs


def test_run_cpp_simulation_normalizes_invalid_season_for_year_flag(
    cpp_sim_env: SimpleNamespace,
) -> None:
    cpp_sim_env.export.write_text(
        json.dumps(
            {
                "gameAttributes": {"season": "playoffs"},
                "players": [{"pid": 0, "tid": 0}, {"pid": 1, "tid": 1}],
            }
        ),
        encoding="utf-8",
    )

    cpp_sim_env.run()

    cmd = cpp_sim_env.captured[0]
    flag_pairs = dict(zip(cmd[4::2], cmd[5::2]))
    assert flag_pairs["-y"] == "2021"


def test_run_cpp_simulation_happy_path_postconditions(cpp_sim_env: SimpleNamespace) -> None:
    """A successful run is one indivisible behavior: all post-conditions hold together."""
    count = cpp_sim_env.run()

    raw = cpp_sim_env.run_dir / "raw"
    meta = json.loads((cpp_sim_env.run_dir / "engine_metadata.json").read_text(encoding="utf-8"))

    assert count == 2  # _fake_exportcleaner_module returns 2 rows
    assert (raw / "outputs.csv").is_file()
    assert (raw / "godprogs.json").is_file()
    assert "simulation" in meta
    assert not (cpp_sim_env.run_dir / "_cpp_tmp_outputs").exists()


def test_run_cpp_simulation_team_filter_writes_filtered_export(cpp_sim_env: SimpleNamespace) -> None:
    cpp_sim_env.run(teams=["BOS"])
    # The filtered (not original) export path is passed as the binary's first arg.
    assert "export_filtered.json" in cpp_sim_env.captured[0][1]


def test_run_cpp_simulation_nonzero_exit_raises(
    cpp_sim_env: SimpleNamespace, monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        subprocess, "run",
        lambda cmd, **_: subprocess.CompletedProcess(cmd, 1),
    )
    with pytest.raises(RuntimeError, match="exited with code 1"):
        cpp_sim_env.run()
