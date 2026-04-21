from __future__ import annotations

import pytest

from services import sim_artifacts


def _rows() -> list[dict[str, object]]:
    return [
        {
            "PlayerID": 0,
            "Name": "Alpha One",
            "Team": "BOS",
            "Age": 29,
            "Baseline": 55,
            "Ovr": 56,
            "Delta": 1.0,
            "PER": 18.5,
            "DWS": 2.4,
            "EWA": 1.2,
        },
        {
            "PlayerID": 0,
            "Name": "Alpha One",
            "Team": "BOS",
            "Age": 29,
            "Baseline": 55,
            "Ovr": 57,
            "Delta": 2.0,
            "PER": 18.5,
            "DWS": 2.4,
            "EWA": 1.2,
        },
        {
            "PlayerID": 1,
            "Name": "Beta Two",
            "Team": "NYK",
            "Age": 31,
            "Baseline": 53,
            "Ovr": 52,
            "Delta": -1.0,
            "PER": 20.1,
            "DWS": 1.9,
            "EWA": 1.5,
        },
        {
            "PlayerID": 1,
            "Name": "Beta Two",
            "Team": "NYK",
            "Age": 31,
            "Baseline": 53,
            "Ovr": 54,
            "Delta": 1.0,
            "PER": 20.1,
            "DWS": 1.9,
            "EWA": 1.5,
        },
    ]


def test_load_outputs_df_reads_indexed_csv(make_run_dir) -> None:
    """Legacy Python engine CSV: pandas wrote a leading unnamed index column."""
    build = "20260101120000"
    make_run_dir(build, raw_rows=_rows())

    df = sim_artifacts.load_outputs_df(build)
    assert list(df.columns[:3]) == ["PlayerID", "Name", "Team"]
    assert "Unnamed: 0" not in df.columns
    assert len(df) == 4


def test_load_outputs_df_reads_unindexed_cpp_csv(make_run_dir, isolated_outputs_dir) -> None:
    """C++ engine CSV: Run is the first column, no leading index column."""
    import io
    import pandas as pd

    build = "20260201120000"
    run_dir = isolated_outputs_dir / build
    raw_dir = run_dir / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)

    # Write exactly as C++ analytics.hpp export_raw_csv produces
    cpp_csv = (
        "Run,RunSeed,Name,Team,Age,PlayerID,Baseline,Ovr,Delta,PctChange,"
        "AboveBaseline,PER,DWS,EWA,dIQ,Dnk,Drb,End,2Pt,FT,Ins,Jmp,"
        "oIQ,Pss,Reb,Spd,Str,3Pt,Hgt\n"
        "0,12345,Alpha One,BOS,29,0,55.0,56.0,1.0,0.018182,True,"
        "18.5,2.4,1.2,54,50,51,52,53,54,55,56,57,58,59,60,61,62,63\n"
        "0,12345,Beta Two,NYK,31,1,53.0,52.0,-1.0,-0.018868,False,"
        "20.1,1.9,1.5,54,50,51,52,53,54,55,56,57,58,59,60,61,62,63\n"
    )
    (raw_dir / "outputs.csv").write_text(cpp_csv, encoding="utf-8")
    (run_dir / "metadata.json").write_text(
        '{"build": "20260201120000", "status": "complete"}', encoding="utf-8"
    )

    df = sim_artifacts.load_outputs_df(build)
    assert "Unnamed: 0" not in df.columns
    assert "Run" in df.columns
    assert df.columns[0] == "Run"
    assert len(df) == 2
    assert df["PlayerID"].tolist() == [0, 1]


def test_list_chart_filenames_returns_sorted_pngs_only(make_run_dir) -> None:
    build = "20260101120000"
    make_run_dir(build, charts=["02_beta.png", "01_alpha.png", "notes.txt"])

    assert sim_artifacts.list_chart_filenames(build) == ["01_alpha.png", "02_beta.png"]


def test_chart_path_rejects_traversal(make_run_dir) -> None:
    build = "20260101120000"
    make_run_dir(build, charts=["01_alpha.png"])

    with pytest.raises(sim_artifacts.InvalidChartNameError, match="Invalid chart name"):
        sim_artifacts.chart_path(build, "../secrets.png")


def test_chart_path_rejects_nested_paths(make_run_dir) -> None:
    build = "20260101120000"
    make_run_dir(build, charts=["01_alpha.png"])

    with pytest.raises(sim_artifacts.InvalidChartNameError, match="Invalid chart name"):
        sim_artifacts.chart_path(build, "subdir/chart.png")


def test_chart_path_rejects_windows_style_nested_paths(make_run_dir) -> None:
    build = "20260101120000"
    make_run_dir(build, charts=["01_alpha.png"])

    with pytest.raises(sim_artifacts.InvalidChartNameError, match="Invalid chart name"):
        sim_artifacts.chart_path(build, r"subdir\chart.png")


def test_player_summaries_and_detail_rows(make_run_dir) -> None:
    build = "20260101120000"
    make_run_dir(build, raw_rows=_rows())

    summary = sim_artifacts.player_summaries(build)
    assert [row["PlayerID"] for row in summary] == [0, 1]
    assert summary[0]["Name"] == "Alpha One"
    assert summary[0]["MeanDelta"] == pytest.approx(1.5)
    assert summary[0]["StdDelta"] == pytest.approx(0.7071, rel=1e-3)

    detail = sim_artifacts.player_all_runs(build, "0")
    assert len(detail) == 2
    assert [row["Delta"] for row in detail] == [1.0, 2.0]

    assert sim_artifacts.player_all_runs(build, "999") == []


def test_godprogs_records_handles_missing_and_invalid_payloads(make_run_dir) -> None:
    build = "20260101120000"
    make_run_dir(build, raw_rows=_rows(), godprogs=[{"name": "Alpha One", "run_seed": 1}])
    assert sim_artifacts.godprogs_records(build) == [{"name": "Alpha One", "run_seed": 1}]

    make_run_dir("20260201120000")
    assert sim_artifacts.godprogs_records("20260201120000") == []

    bad = make_run_dir("20260301120000")
    (bad / "raw" / "godprogs.json").parent.mkdir(parents=True, exist_ok=True)
    (bad / "raw" / "godprogs.json").write_text("{}", encoding="utf-8")
    assert sim_artifacts.godprogs_records("20260301120000") == []


def test_path_helpers_point_to_expected_files(make_run_dir) -> None:
    build = "20260101120000"
    make_run_dir(build)

    assert sim_artifacts.analysis_xlsx_path(build).name == "analysis.xlsx"
    assert sim_artifacts.raw_outputs_csv_path(build).name == "outputs.csv"
