from __future__ import annotations

from services import storage


def test_list_runs_sorted_and_skips_invalid_entries(make_run_dir) -> None:
    make_run_dir("20260101120000", metadata={"status": "complete"})
    make_run_dir("20260201120000", metadata={"status": "running"})

    bad = make_run_dir("20260301120000", metadata={"status": "failed"})
    (bad / "metadata.json").unlink()

    malformed = make_run_dir("20260401120000", metadata={"status": "complete"})
    (malformed / "metadata.json").write_text("{not-json}", encoding="utf-8")

    run = storage.get_run("20260101120000")
    assert run is not None
    assert run.build == "20260101120000"

    assert storage.get_run("not-a-build") is None

    builds = [item.build for item in storage.list_runs()]
    assert builds == ["20260201120000", "20260101120000"]


def test_get_run_returns_none_for_missing_or_invalid_metadata() -> None:
    assert storage.get_run("20260101120000") is None
    assert storage.get_run("bad-build") is None


def test_delete_run_removes_directory(make_run_dir) -> None:
    build = "20260101120000"
    run_dir = make_run_dir(build)

    assert storage.delete_run(build) is True
    assert not run_dir.exists()
    assert storage.delete_run(build) is False
    assert storage.delete_run("not-a-build") is False


def test_outputs_root_defaults_to_monkeypatched_env(isolated_outputs_dir) -> None:
    assert storage.outputs_root() == isolated_outputs_dir
