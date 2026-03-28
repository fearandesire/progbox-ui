"""Load simulation outputs (CSV, charts, godprogs) from disk."""

from __future__ import annotations

import json
from pathlib import Path
from pathlib import PurePosixPath
from pathlib import PureWindowsPath
from typing import Any

import pandas as pd

from services.storage import outputs_root


class InvalidChartNameError(ValueError):
    """Raised when a chart name is not a flat filename."""


def _raw_dir(build: str) -> Path:
    return outputs_root() / build / "raw"


def _outputs_csv(build: str) -> Path:
    return _raw_dir(build) / "outputs.csv"


def load_outputs_df(build: str) -> pd.DataFrame:
    path = _outputs_csv(build)
    if not path.is_file():
        raise FileNotFoundError(str(path))
    return pd.read_csv(path, index_col=0)


def list_chart_filenames(build: str) -> list[str]:
    charts = outputs_root() / build / "charts"
    if not charts.is_dir():
        return []
    return sorted(p.name for p in charts.glob("*.png"))


def chart_path(build: str, name: str) -> Path:
    """Resolve chart path; raises if traversal or missing."""
    base = (outputs_root() / build / "charts").resolve()
    if (
        not name
        or name in {".", ".."}
        or PurePosixPath(name).name != name
        or PureWindowsPath(name).name != name
    ):
        raise InvalidChartNameError("Invalid chart name")
    target = (base / name).resolve()
    try:
        target.relative_to(base)
    except ValueError as exc:
        raise InvalidChartNameError("Invalid chart name") from exc
    if not target.is_file():
        raise FileNotFoundError(str(target))
    return target


def player_summaries(build: str) -> list[dict[str, Any]]:
    df = load_outputs_df(build)
    ppl = (
        df.groupby("PlayerID", sort=True)
        .agg(
            Name=("Name", "first"),
            Team=("Team", "first"),
            Age=("Age", "first"),
            Baseline=("Baseline", "first"),
            MeanDelta=("Delta", "mean"),
            StdDelta=("Delta", "std"),
            P05=("Ovr", lambda s: s.quantile(0.05)),
            P25=("Ovr", lambda s: s.quantile(0.25)),
            P50=("Ovr", "median"),
            P75=("Ovr", lambda s: s.quantile(0.75)),
            P95=("Ovr", lambda s: s.quantile(0.95)),
        )
        .reset_index()
    )
    # JSON-serializable native types
    return ppl.round(4).to_dict(orient="records")


def player_all_runs(build: str, pid: str) -> list[dict[str, Any]]:
    df = load_outputs_df(build)
    if "PlayerID" not in df.columns:
        return []
    # Coerce PlayerID to string for URL param matching
    sub = df[df["PlayerID"].astype(str) == str(pid)]
    if sub.empty:
        return []
    return sub.round(4).to_dict(orient="records")


def godprogs_records(build: str) -> list[dict[str, Any]]:
    path = _raw_dir(build) / "godprogs.json"
    if not path.is_file() or path.stat().st_size <= 2:
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, list):
        return []
    return data


def analysis_xlsx_path(build: str) -> Path:
    return outputs_root() / build / "analysis.xlsx"


def raw_outputs_csv_path(build: str) -> Path:
    return _outputs_csv(build)
