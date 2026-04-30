"""Generate a BBGM teaminfo mapping from an uploaded export.

The vendored engine (``exportcleaner``) needs a ``teaminfo.json`` — a
``{tid → abbrev}`` map — to resolve each player's team. We used to ship a
static ``data/teaminfo.json`` fallback, but that drifted from any league
that wasn't stock-modern BBGM (alternate eras, expansion, custom rosters).

Every export already carries ``tid`` + ``abbrev`` + ``active`` on each
team, so we derive the map at upload time. The three negative slots are
BBGM game rules (free agents, undrafted, retired), not teams, so we
always append them verbatim.
"""

from __future__ import annotations

from typing import Any

SPECIAL_ENTRIES: dict[str, str] = {
    "-1": "FA",
    "-2": "UDFA",
    "-3": "Retired",
}


class InvalidTeaminfoError(ValueError):
    """Raised when a user-supplied teaminfo override fails schema checks."""


def generate_teaminfo(export_data: dict[str, Any]) -> dict[str, str]:
    """Build ``{tid → abbrev}`` from active teams in an export, plus FA/UDFA/Retired."""
    teams = export_data.get("teams") or []
    out: dict[str, str] = {}
    for t in teams:
        if not isinstance(t, dict) or not t.get("active", True):
            continue
        tid = t.get("tid")
        abbrev = t.get("abbrev")
        if tid is None or not abbrev:
            continue
        out[str(tid)] = str(abbrev).upper()
    out.update(SPECIAL_ENTRIES)
    return out


def validate_teaminfo(data: object) -> dict[str, str]:
    """Validate a user-uploaded teaminfo override, returning the normalised dict.

    BBGM tids are integers serialised as string keys, and the three negative
    slots are allowed, so we accept any non-empty string keys and values.
    """
    if not isinstance(data, dict):
        raise InvalidTeaminfoError("teaminfo.json must be a JSON object mapping team IDs to abbreviations")
    out: dict[str, str] = {}
    for k, v in data.items():
        if not isinstance(k, str) or not k:
            raise InvalidTeaminfoError(f"teaminfo key must be a non-empty string, got {k!r}")
        if not isinstance(v, str) or not v:
            raise InvalidTeaminfoError(f"teaminfo value for key {k!r} must be a non-empty string")
        out[k] = v
    return out
