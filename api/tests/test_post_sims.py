from __future__ import annotations

import json
from unittest.mock import MagicMock

import pytest


def test_post_sim_creates_build_and_schedules_job(client, monkeypatch: pytest.MonkeyPatch) -> None:
    import routes.sims as sims_routes

    mock_job = MagicMock()
    # Import-bound names in routes.sims must be patched.
    monkeypatch.setattr(sims_routes, "run_simulation_job", mock_job)

    export_payload = {"players": [{"stats": [], "tid": 0}]}
    r = client.post(
        "/api/sims",
        files=[
            ("export", ("export.json", json.dumps(export_payload).encode(), "application/json")),
            ("teaminfo", ("teaminfo.json", json.dumps({"0": "BOS"}).encode(), "application/json")),
        ],
        data={"config": '{"teams":[],"seed":1,"runs":10,"n_workers":1}'},
    )
    assert r.status_code == 200
    body = r.json()
    assert "build" in body
    build = body["build"]
    assert len(build) == 14
    assert body == {"build": build}
    mock_job.assert_called_once()
    args = mock_job.call_args.args
    assert args[0] == build
    assert args[1].name == "export.json"
    assert args[2].name == "teaminfo.json"
    assert args[3] == []
    assert args[4] == 1
    assert args[5] == 10
    assert args[6] >= 1


def test_post_sim_validation_errors(client, monkeypatch: pytest.MonkeyPatch) -> None:
    import routes.sims as sims_routes

    monkeypatch.setattr(sims_routes, "run_simulation_job", MagicMock())

    base_config = '{"teams":[],"seed":1,"runs":10,"n_workers":1}'

    empty_export = client.post(
        "/api/sims",
        files={"export": ("export.json", b"", "application/json")},
        data={"config": base_config},
    )
    assert empty_export.status_code == 422

    empty_teaminfo = client.post(
        "/api/sims",
        files={
            "export": ("export.json", json.dumps({"players": []}).encode(), "application/json"),
            "teaminfo": ("teaminfo.json", b"", "application/json"),
        },
        data={"config": base_config},
    )
    assert empty_teaminfo.status_code == 422

    invalid_workers = client.post(
        "/api/sims",
        files={
            "export": ("export.json", json.dumps({"players": []}).encode(), "application/json"),
        },
        data={"config": '{"teams":[],"seed":1,"runs":10,"n_workers":0}'},
    )
    assert invalid_workers.status_code == 422


def test_post_sim_without_teaminfo_auto_generates_from_export(
    client,
    isolated_outputs_dir,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import routes.sims as sims_routes

    monkeypatch.setattr(sims_routes, "run_simulation_job", MagicMock())

    export_payload = {
        "players": [{"tid": 0, "stats": []}, {"tid": 1, "stats": []}],
        "teams": [
            {"tid": 0, "abbrev": "bos", "active": True},
            {"tid": 1, "abbrev": "NYK", "active": True},
            {"tid": 2, "abbrev": "OLD", "active": False},
        ],
    }
    r = client.post(
        "/api/sims",
        files={
            "export": ("export.json", json.dumps(export_payload).encode(), "application/json"),
        },
        data={"config": '{"teams":[],"seed":1,"runs":10,"n_workers":1}'},
    )
    assert r.status_code == 200
    build = r.json()["build"]

    generated = json.loads((isolated_outputs_dir / build / "teaminfo.json").read_text(encoding="utf-8"))
    assert generated == {
        "0": "BOS",
        "1": "NYK",
        "-1": "FA",
        "-2": "UDFA",
        "-3": "Retired",
    }
    meta = json.loads((isolated_outputs_dir / build / "metadata.json").read_text(encoding="utf-8"))
    assert meta["teaminfo_source"] == "generated"


def test_post_sim_with_uploaded_teaminfo_records_user_source(
    client,
    isolated_outputs_dir,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import routes.sims as sims_routes

    monkeypatch.setattr(sims_routes, "run_simulation_job", MagicMock())

    r = client.post(
        "/api/sims",
        files=[
            ("export", ("export.json", json.dumps({"players": [], "teams": []}).encode(), "application/json")),
            ("teaminfo", ("teaminfo.json", json.dumps({"0": "CUSTOM"}).encode(), "application/json")),
        ],
        data={"config": '{"teams":[],"seed":1,"runs":10,"n_workers":1}'},
    )
    assert r.status_code == 200
    build = r.json()["build"]

    meta = json.loads((isolated_outputs_dir / build / "metadata.json").read_text(encoding="utf-8"))
    assert meta["teaminfo_source"] == "user"


def test_post_sim_rejects_malformed_teaminfo_override(
    client,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import routes.sims as sims_routes

    monkeypatch.setattr(sims_routes, "run_simulation_job", MagicMock())

    # Wrong shape: JSON array instead of object
    r = client.post(
        "/api/sims",
        files=[
            ("export", ("export.json", json.dumps({"players": [], "teams": []}).encode(), "application/json")),
            ("teaminfo", ("teaminfo.json", json.dumps(["BOS", "NYK"]).encode(), "application/json")),
        ],
        data={"config": '{"teams":[],"seed":1,"runs":10,"n_workers":1}'},
    )
    assert r.status_code == 400
    assert "teaminfo" in r.json()["detail"].lower()


def test_post_sim_uses_default_worker_count_when_missing(
    client,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import routes.sims as sims_routes

    mock_job = MagicMock()
    monkeypatch.setattr(sims_routes, "run_simulation_job", mock_job)

    r = client.post(
        "/api/sims",
        files={
            "export": (
                "export.json",
                json.dumps({"players": []}).encode(),
                "application/json",
            ),
            "teaminfo": ("teaminfo.json", json.dumps({"0": "BOS"}).encode(), "application/json"),
        },
        data={"config": '{"teams":["BOS"],"seed":1,"runs":10}'},
    )
    assert r.status_code == 200
    args = mock_job.call_args.args
    assert args[0] == r.json()["build"]
    assert args[6] >= 1
