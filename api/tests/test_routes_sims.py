from __future__ import annotations

import json

import pytest

def test_list_sims_empty(client) -> None:
    r = client.get("/api/sims")
    assert r.status_code == 200
    assert r.json() == []


def test_list_sims_sorted_and_skips_incomplete_runs(client, make_run_dir) -> None:
    make_run_dir("20260101120000")
    make_run_dir("20260201120000", metadata={"status": "running"})
    incomplete = make_run_dir("20260301120000")
    (incomplete / "metadata.json").unlink()
    make_run_dir("not-a-build")

    r = client.get("/api/sims")
    assert r.status_code == 200
    builds = [run["build"] for run in r.json()]
    assert builds == ["20260201120000", "20260101120000"]


def test_get_sim_invalid_build(client) -> None:
    r = client.get("/api/sims/not-a-build")
    assert r.status_code == 422


def test_get_sim_not_found(client) -> None:
    r = client.get("/api/sims/20260101120000")
    assert r.status_code == 404


def test_get_sim_ok(client, make_run_dir) -> None:
    build = "20260101120000"
    make_run_dir(build, metadata={"status": "complete", "teams": ["BOS"]})

    r = client.get(f"/api/sims/{build}")
    assert r.status_code == 200
    body = r.json()
    assert body["build"] == build
    assert body["status"] == "complete"
    assert body["teams"] == ["BOS"]


def test_progress_stream_running_uses_live_progress_payload(client, make_run_dir) -> None:
    import routes.sims as sims_routes

    build = "20260101120000"
    make_run_dir(build, metadata={"status": "running"})
    sims_routes.PROGRESS[build] = {
        "phase": "simulating",
        "pct": 42.5,
        "message": "Simulating",
        "done": True,
    }

    with client.stream("GET", f"/api/sims/{build}/progress") as response:
        line = next(response.iter_lines())
    if isinstance(line, bytes):
        line = line.decode("utf-8")
    assert line.startswith("data: ")
    payload = json.loads(line.removeprefix("data: "))
    assert payload == {
        "phase": "simulating",
        "pct": 42.5,
        "message": "Simulating",
        "done": True,
    }


def test_progress_stream_complete_finishes_from_metadata(client, make_run_dir) -> None:
    build = "20260101120000"
    make_run_dir(build, metadata={"status": "complete"})

    r = client.get(f"/api/sims/{build}/progress")
    assert r.status_code == 200
    assert '"phase": "complete"' in r.text
    assert '"done": true' in r.text


def test_progress_stream_failed_finishes_from_metadata(client, make_run_dir) -> None:
    build = "20260101120000"
    make_run_dir(build, metadata={"status": "failed", "error": "boom"})

    r = client.get(f"/api/sims/{build}/progress")
    assert r.status_code == 200
    assert '"phase": "failed"' in r.text
    assert '"message": "boom"' in r.text


def test_progress_stream_missing_run_returns_404(client) -> None:
    r = client.get("/api/sims/20260101120000/progress")
    assert r.status_code == 404


def test_charts_list_not_found(client) -> None:
    r = client.get("/api/sims/20260101120000/charts")
    assert r.status_code == 404


def test_charts_list_and_lookup(client, make_run_dir) -> None:
    build = "20260101120000"
    make_run_dir(build, charts=["02_beta.png", "01_alpha.png", "notes.txt"])

    r = client.get(f"/api/sims/{build}/charts")
    assert r.status_code == 200
    assert r.json() == ["01_alpha.png", "02_beta.png"]

    chart = client.get(f"/api/sims/{build}/charts/01_alpha.png")
    assert chart.status_code == 200
    assert chart.headers["content-type"] == "image/png"
    assert chart.content == b"png"


def test_chart_lookup_rejects_traversal(client, make_run_dir) -> None:
    build = "20260101120000"
    make_run_dir(build, charts=["01_alpha.png"])

    r = client.get(f"/api/sims/{build}/charts/subdir/chart.png")
    assert r.status_code == 400


def test_chart_lookup_missing_returns_404(client, make_run_dir) -> None:
    build = "20260101120000"
    make_run_dir(build)

    r = client.get(f"/api/sims/{build}/charts/missing.png")
    assert r.status_code == 404


def test_players_and_player_detail_routes(client, make_run_dir) -> None:
    build = "20260101120000"
    make_run_dir(
        build,
        raw_rows=[
            {
                "PlayerID": 0,
                "Name": "Alpha One",
                "Team": "BOS",
                "Age": 29,
                "Baseline": 55,
                "Ovr": 56,
                "Delta": 1.0,
            },
            {
                "PlayerID": 0,
                "Name": "Alpha One",
                "Team": "BOS",
                "Age": 29,
                "Baseline": 55,
                "Ovr": 57,
                "Delta": 2.0,
            },
            {
                "PlayerID": 1,
                "Name": "Beta Two",
                "Team": "NYK",
                "Age": 31,
                "Baseline": 53,
                "Ovr": 52,
                "Delta": -1.0,
            },
            {
                "PlayerID": 1,
                "Name": "Beta Two",
                "Team": "NYK",
                "Age": 31,
                "Baseline": 53,
                "Ovr": 54,
                "Delta": 1.0,
            },
        ],
    )

    summary = client.get(f"/api/sims/{build}/players")
    assert summary.status_code == 200
    rows = summary.json()
    assert [row["PlayerID"] for row in rows] == [0, 1]
    assert rows[0]["Name"] == "Alpha One"
    assert rows[0]["MeanDelta"] == pytest.approx(1.5)

    detail = client.get(f"/api/sims/{build}/players/0")
    assert detail.status_code == 200
    assert len(detail.json()) == 2
    assert detail.json()[0]["Name"] == "Alpha One"


def test_player_detail_missing_returns_404(client, make_run_dir) -> None:
    build = "20260101120000"
    make_run_dir(build, raw_rows=[{"PlayerID": 0, "Name": "Alpha One", "Team": "BOS", "Age": 29, "Baseline": 55, "Ovr": 56, "Delta": 1.0}])

    r = client.get(f"/api/sims/{build}/players/999")
    assert r.status_code == 404


def test_godprogs_route_returns_records(client, make_run_dir) -> None:
    build = "20260101120000"
    make_run_dir(build, godprogs=[{"name": "Alpha One", "run_seed": 1}])

    r = client.get(f"/api/sims/{build}/godprogs")
    assert r.status_code == 200
    assert r.json() == [{"name": "Alpha One", "run_seed": 1}]


def test_download_routes_and_invalid_query(client, make_run_dir) -> None:
    build = "20260101120000"
    make_run_dir(
        build,
        extra_files={
            "analysis.xlsx": "xlsx-bytes",
            "raw/outputs.csv": "PlayerID,Name\n0,Alpha One\n",
        },
    )

    xlsx = client.get(f"/api/sims/{build}/download?artifact=analysis")
    assert xlsx.status_code == 200
    assert "analysis.xlsx" in xlsx.headers["content-disposition"]
    assert xlsx.content == b"xlsx-bytes"

    csv = client.get(f"/api/sims/{build}/download?artifact=csv")
    assert csv.status_code == 200
    assert csv.headers["content-type"].startswith("text/csv")
    assert csv.content.replace(b"\r\n", b"\n") == b"PlayerID,Name\n0,Alpha One\n"

    invalid = client.get(f"/api/sims/{build}/download?artifact=zip")
    assert invalid.status_code == 422


def test_delete_not_found(client) -> None:
    r = client.delete("/api/sims/20260101120000")
    assert r.status_code == 404


def test_delete_ok(client, make_run_dir) -> None:
    build = "20260101120000"
    run_dir = make_run_dir(build)

    r = client.delete(f"/api/sims/{build}")
    assert r.status_code == 200
    assert r.json() == {"ok": True}
    assert not run_dir.exists()


def test_nested_routes_before_generic_build(client, make_run_dir) -> None:
    """Progress path must not be captured as `{build}`."""
    build = "20260101120000"
    make_run_dir(build, metadata={"status": "complete", "teams": []})

    r = client.get(f"/api/sims/{build}/progress")
    assert r.status_code == 200
    assert r.headers.get("content-type", "").startswith("text/event-stream")
