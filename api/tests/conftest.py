from __future__ import annotations

import json
from pathlib import Path
from typing import Callable, Iterable

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from main import app


@pytest.fixture(autouse=True)
def isolated_outputs_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    root = tmp_path / "outputs"
    monkeypatch.setenv("PROGBOX_OUTPUTS_DIR", str(root))
    return root


@pytest.fixture(autouse=True)
def isolated_runner_progress() -> None:
    from services import runner

    runner.PROGRESS.clear()
    yield
    runner.PROGRESS.clear()


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture
def build_id() -> str:
    return "20260101120000"


def _base_metadata(build: str, **overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "build": build,
        "script_version": "v4.1",
        "status": "complete",
        "teams": [],
        "seed": 1,
        "runs": 1,
        "n_workers": 1,
        "export_file": f"outputs/{build}/export.json",
        "teaminfo_file": f"outputs/{build}/teaminfo.json",
        "started_at": "2026-01-01T12:00:00Z",
        "completed_at": "2026-01-01T12:00:01Z",
        "player_count": 2,
        "config_snapshot": {"ovr_hard_cap": 80},
        "error": None,
    }
    payload.update(overrides)
    return payload


@pytest.fixture
def metadata_factory() -> Callable[..., dict[str, object]]:
    return _base_metadata


@pytest.fixture
def make_run_dir(isolated_outputs_dir: Path) -> Callable[..., Path]:
    def _make(
        build: str,
        *,
        metadata: dict[str, object] | None = None,
        raw_rows: Iterable[dict[str, object]] | None = None,
        charts: Iterable[str] | None = None,
        godprogs: list[dict[str, object]] | None = None,
        extra_files: dict[str, str] | None = None,
    ) -> Path:
        run_dir = isolated_outputs_dir / build
        run_dir.mkdir(parents=True, exist_ok=True)
        payload = _base_metadata(build)
        if metadata:
            payload.update(metadata)
        (run_dir / "metadata.json").write_text(json.dumps(payload), encoding="utf-8")

        if raw_rows is not None:
            raw_dir = run_dir / "raw"
            raw_dir.mkdir(parents=True, exist_ok=True)
            pd.DataFrame(list(raw_rows)).to_csv(raw_dir / "outputs.csv")

        if charts is not None:
            charts_dir = run_dir / "charts"
            charts_dir.mkdir(parents=True, exist_ok=True)
            for name in charts:
                (charts_dir / name).write_bytes(b"png")

        if godprogs is not None:
            raw_dir = run_dir / "raw"
            raw_dir.mkdir(parents=True, exist_ok=True)
            (raw_dir / "godprogs.json").write_text(
                json.dumps(godprogs, indent=2),
                encoding="utf-8",
            )

        if extra_files:
            for rel_path, content in extra_files.items():
                target = run_dir / rel_path
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(content, encoding="utf-8")

        return run_dir

    return _make


@pytest.fixture
def sample_teaminfo() -> dict[str, str]:
    return {"0": "BOS", "1": "NYK", "2": "GSW", "3": "SAC"}


def _player(
    pid: int,
    first_name: str,
    last_name: str,
    tid: int,
    born_year: int,
    *,
    per: float,
    dws: float,
    ewa: float,
    ratings: dict[str, int] | None = None,
) -> dict[str, object]:
    attrs = {
        "dIQ": 54,
        "Dnk": 50,
        "Drb": 51,
        "End": 52,
        "2Pt": 53,
        "FT": 54,
        "Ins": 55,
        "Jmp": 56,
        "oIQ": 57,
        "Pss": 58,
        "Reb": 59,
        "Spd": 60,
        "Str": 61,
        "3Pt": 62,
        "Hgt": 63,
        "Ovr": 55,
    }
    if ratings:
        attrs.update(ratings)

    return {
        "pid": pid,
        "firstName": first_name,
        "lastName": last_name,
        "tid": tid,
        "born": {"year": born_year, "loc": "USA"},
        "stats": [
            {
                "per": per,
                "dws": dws,
                "ewa": ewa,
                "playoffs": False,
                "gp": 82,
            }
        ],
        "ratings": [attrs],
    }


@pytest.fixture
def sample_export_payload(sample_teaminfo: dict[str, str]) -> dict[str, object]:
    return {
        "version": 68,
        "meta": {"name": "Fixture League"},
        "gameAttributes": {"season": 2024, "phase": "regularSeason"},
        "players": [
            _player(0, "Alpha", "One", 0, 1992, per=10.0, dws=1.0, ewa=0.5),
            _player(1, "Beta", "Two", 1, 1992, per=14.0, dws=1.2, ewa=0.7),
            _player(2, "Gamma", "Three", 2, 1992, per=18.0, dws=1.6, ewa=1.0),
            _player(3, "Delta", "Four", 3, 1992, per=22.0, dws=1.8, ewa=1.2),
            _player(4, "Epsilon", "Five", 0, 1992, per=26.0, dws=2.0, ewa=1.4),
            _player(5, "Zeta", "Six", 1, 1992, per=30.0, dws=2.2, ewa=1.6),
        ],
        "teaminfo": sample_teaminfo,
    }


@pytest.fixture
def write_json() -> Callable[[Path, object], Path]:
    def _write(path: Path, payload: object) -> Path:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        return path

    return _write
