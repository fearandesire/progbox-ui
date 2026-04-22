from __future__ import annotations

import pytest

from services.teaminfo import (
    SPECIAL_ENTRIES,
    InvalidTeaminfoError,
    generate_teaminfo,
    validate_teaminfo,
)


class TestGenerateTeaminfo:
    def test_maps_active_teams_and_appends_special_entries(self) -> None:
        export = {
            "teams": [
                {"tid": 0, "abbrev": "BOS", "active": True},
                {"tid": 1, "abbrev": "NYK", "active": True},
            ]
        }
        result = generate_teaminfo(export)
        assert result == {"0": "BOS", "1": "NYK", **SPECIAL_ENTRIES}

    def test_excludes_inactive_teams(self) -> None:
        export = {
            "teams": [
                {"tid": 0, "abbrev": "BOS", "active": True},
                {"tid": 999, "abbrev": "DEFUNCT", "active": False},
                {"tid": 1000, "abbrev": "NOFLAG"},  # missing active flag → excluded
            ]
        }
        result = generate_teaminfo(export)
        assert "999" not in result
        assert "1000" not in result
        assert result["0"] == "BOS"

    def test_uppercases_abbreviations(self) -> None:
        export = {"teams": [{"tid": 0, "abbrev": "bos", "active": True}]}
        assert generate_teaminfo(export)["0"] == "BOS"

    def test_empty_teams_returns_only_special_entries(self) -> None:
        assert generate_teaminfo({"teams": []}) == dict(SPECIAL_ENTRIES)

    def test_missing_teams_key_returns_only_special_entries(self) -> None:
        assert generate_teaminfo({}) == dict(SPECIAL_ENTRIES)

    def test_skips_teams_missing_tid_or_abbrev(self) -> None:
        export = {
            "teams": [
                {"abbrev": "NOID", "active": True},
                {"tid": 5, "active": True},
                {"tid": 6, "abbrev": "", "active": True},
                {"tid": 7, "abbrev": "OK", "active": True},
            ]
        }
        result = generate_teaminfo(export)
        assert result == {"7": "OK", **SPECIAL_ENTRIES}

    def test_special_entries_preserve_casing(self) -> None:
        result = generate_teaminfo({"teams": []})
        assert result["-1"] == "FA"
        assert result["-2"] == "UDFA"
        assert result["-3"] == "Retired"


class TestValidateTeaminfo:
    def test_accepts_valid_map(self) -> None:
        data = {"0": "BOS", "-1": "FA"}
        assert validate_teaminfo(data) == data

    def test_rejects_non_object(self) -> None:
        with pytest.raises(InvalidTeaminfoError, match="JSON object"):
            validate_teaminfo(["BOS", "NYK"])

    def test_rejects_none(self) -> None:
        with pytest.raises(InvalidTeaminfoError):
            validate_teaminfo(None)

    def test_rejects_empty_key(self) -> None:
        with pytest.raises(InvalidTeaminfoError, match="non-empty string"):
            validate_teaminfo({"": "BOS"})

    def test_rejects_non_string_value(self) -> None:
        with pytest.raises(InvalidTeaminfoError, match="non-empty string"):
            validate_teaminfo({"0": 1})

    def test_rejects_empty_value(self) -> None:
        with pytest.raises(InvalidTeaminfoError, match="non-empty string"):
            validate_teaminfo({"0": ""})
