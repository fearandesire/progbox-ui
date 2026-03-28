from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from main import app


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def test_list_sims_empty(client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    import services.storage as storage

    monkeypatch.setattr(storage, "outputs_root", lambda: tmp_path)
    r = client.get("/api/sims")
    assert r.status_code == 200
    assert r.json() == []


def test_get_sim_invalid_build(client: TestClient) -> None:
    r = client.get("/api/sims/not-a-build")
    assert r.status_code == 422


def test_get_sim_not_found(client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    import services.storage as storage

    monkeypatch.setattr(storage, "outputs_root", lambda: tmp_path)
    r = client.get("/api/sims/20260101120000")
    assert r.status_code == 404


def test_get_sim_ok(client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    import services.storage as storage

    monkeypatch.setattr(storage, "outputs_root", lambda: tmp_path)
    build = "20260101120000"
    run_dir = tmp_path / build
    run_dir.mkdir()
    payload = {"build": build, "status": "complete", "teams": []}
    (run_dir / "metadata.json").write_text(json.dumps(payload), encoding="utf-8")

    r = client.get(f"/api/sims/{build}")
    assert r.status_code == 200
    body = r.json()
    assert body["build"] == build
    assert body["status"] == "complete"


def test_nested_routes_before_generic_build(client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Progress path must not be captured as `{build}`."""
    import services.storage as storage

    monkeypatch.setattr(storage, "outputs_root", lambda: tmp_path)
    build = "20260101120000"
    run_dir = tmp_path / build
    run_dir.mkdir()
    payload = {"build": build, "status": "complete", "teams": []}
    (run_dir / "metadata.json").write_text(json.dumps(payload), encoding="utf-8")

    r = client.get(f"/api/sims/{build}/progress")
    assert r.status_code == 200
    assert r.headers.get("content-type", "").startswith("text/event-stream")


def test_charts_list_not_found(client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    import services.storage as storage

    monkeypatch.setattr(storage, "outputs_root", lambda: tmp_path)
    r = client.get("/api/sims/20260101120000/charts")
    assert r.status_code == 404


def test_delete_not_found(client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    import services.storage as storage

    monkeypatch.setattr(storage, "outputs_root", lambda: tmp_path)
    r = client.delete("/api/sims/20260101120000")
    assert r.status_code == 404


def test_delete_ok(client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    import services.storage as storage

    monkeypatch.setattr(storage, "outputs_root", lambda: tmp_path)
    build = "20260101120000"
    run_dir = tmp_path / build
    run_dir.mkdir()
    payload = {"build": build, "status": "complete", "teams": []}
    (run_dir / "metadata.json").write_text(json.dumps(payload), encoding="utf-8")

    r = client.delete(f"/api/sims/{build}")
    assert r.status_code == 200
    assert r.json() == {"ok": True}
    assert not run_dir.exists()
