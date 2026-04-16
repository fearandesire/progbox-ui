"""Import boundary for vendored progbox engine (api/vendor/progbox_v41)."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from types import ModuleType
from typing import Any

_VENDOR_DIR = Path(__file__).resolve().parent.parent / "vendor" / "progbox_v41"
_VERSION_FILE = _VENDOR_DIR / "VERSION"


def vendor_dir() -> Path:
    return _VENDOR_DIR


def script_version() -> str:
    if _VERSION_FILE.is_file():
        return _VERSION_FILE.read_text(encoding="utf-8").strip()
    return "v4.1"


def _ensure_vendor_path() -> None:
    root = str(_VENDOR_DIR.resolve())
    if root not in sys.path:
        sys.path.insert(0, root)


def load_analysis_module() -> ModuleType:
    _ensure_vendor_path()
    return importlib.import_module("analysis")


def load_exportcleaner_module() -> ModuleType:
    _ensure_vendor_path()
    return importlib.import_module("exportcleaner")


def load_runsim_class() -> type:
    _ensure_vendor_path()
    mod = importlib.import_module("runsim")
    return mod.runsim


def load_progutils_config() -> Any:
    _ensure_vendor_path()
    mod = importlib.import_module("progutils")
    return mod.Config


def config_snapshot() -> dict[str, Any]:
    """Full Config constants for run metadata."""
    Config = load_progutils_config()
    return {
        "composite": dict(Config.COMPOSITE),
        "age_groups": {k: dict(v) for k, v in Config.AGE_GROUP_CONFIG.items()},
        "god_prog": dict(Config.GOD_PROG),
        "ovr_hard_cap": Config.OVR_HARD_CAP,
    }
