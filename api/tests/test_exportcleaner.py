from __future__ import annotations

import os
from pathlib import Path

import pytest

from services import engine_adapter


@pytest.mark.parametrize("raw_season", [None, "playoffs"], ids=["none", "nonnumeric-string"])
def test_exportcleaner_invalid_season_uses_default_year_for_age(
    tmp_path: Path,
    sample_export_payload: dict[str, object],
    sample_teaminfo: dict[str, str],
    write_json,
    raw_season: object,
) -> None:
    export_payload = {
        **sample_export_payload,
        "gameAttributes": {
            **sample_export_payload["gameAttributes"],
            "season": raw_season,
        },
    }
    export_path = write_json(tmp_path / "export.json", export_payload)
    teaminfo_path = write_json(tmp_path / "teaminfo.json", sample_teaminfo)
    (tmp_path / "data").mkdir()

    previous_cwd = Path.cwd()
    try:
        os.chdir(tmp_path)
        exportcleaner = engine_adapter.load_exportcleaner_module()
        df, _ = exportcleaner.exportcleaner(
            export_file=str(export_path),
            teams=[],
            teaminfo_file=str(teaminfo_path),
        )
    finally:
        os.chdir(previous_cwd)

    assert not df.empty
    assert set(df["Age"]) == {29}
