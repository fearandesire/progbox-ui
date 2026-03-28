from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from main import app


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def test_post_sim_creates_build_and_schedules_job(
    client: TestClient,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import routes.sims as sims_routes

    monkeypatch.setattr(sims_routes, "outputs_root", lambda: tmp_path)
    mock_job = MagicMock()
    # Import-bound names in routes.sims must be patched.
    monkeypatch.setattr(sims_routes, "run_simulation_job", mock_job)

    export_payload = {"players": [{"stats": [], "tid": 0}]}
    r = client.post(
        "/api/sims",
        files={"export": ("export.json", json.dumps(export_payload).encode(), "application/json")},
        data={"config": '{"teams":[],"seed":1,"runs":10,"n_workers":1}'},
    )
    assert r.status_code == 200
    body = r.json()
    assert "build" in body
    build = body["build"]
    assert len(build) == 14
    assert (tmp_path / build / "metadata.json").is_file()
    mock_job.assert_called_once()


def test_list_charts_empty_when_no_pngs(
    client: TestClient,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import services.storage as storage

    monkeypatch.setattr(storage, "outputs_root", lambda: tmp_path)
    build = "20260101120000"
    run_dir = tmp_path / build
    run_dir.mkdir()
    (run_dir / "metadata.json").write_text(
        json.dumps({"build": build, "status": "complete", "teams": []}),
        encoding="utf-8",
    )
    (run_dir / "charts").mkdir()

    r = client.get(f"/api/sims/{build}/charts")
    assert r.status_code == 200
    assert r.json() == []
