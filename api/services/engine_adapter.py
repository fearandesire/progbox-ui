"""Import boundary for vendored progbox engines.

The C++ engine (progbox_cpp) is the active simulation backend.
The Python engine (progbox_v41) is retained for exportcleaner/analysis helpers.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from types import ModuleType
from typing import Any

_PYTHON_VENDOR_DIR = Path(__file__).resolve().parent.parent / "vendor" / "progbox_v41"
_CPP_VENDOR_DIR = Path(__file__).resolve().parent.parent / "vendor" / "progbox_cpp"
_VERSION_FILE = _CPP_VENDOR_DIR / "VERSION"


def vendor_dir() -> Path:
    return _CPP_VENDOR_DIR


def script_version() -> str:
    if _VERSION_FILE.is_file():
        return _VERSION_FILE.read_text(encoding="utf-8").strip()
    return "v4.1"


def _ensure_python_vendor_path() -> None:
    root = str(_PYTHON_VENDOR_DIR.resolve())
    if root not in sys.path:
        sys.path.insert(0, root)


def load_exportcleaner_module() -> ModuleType:
    _ensure_python_vendor_path()
    return importlib.import_module("exportcleaner")


# Static v41 config snapshot — mirrors the Python Config constants exactly.
# Kept as a manifest so /api/config response shape is preserved without
# importing Python engine modules at runtime.
_V41_CONFIG: dict[str, Any] = {
    "composite": {"per": 0.70, "dws": 0.20, "ewa": 0.10},
    "age_groups": {
        "26-30": {"min1": 5, "min2": 7, "max1": 4, "max2": 2, "hard_max": 4},
        "31-34": {"min1": 6, "min2": 7, "max1": 4, "max2": 3, "hard_max": 2},
        "35+":   {"min1": 6, "min2": 9, "max1": None, "max2": None, "hard_max": 0},
    },
    "god_prog": {
        "chance": 0.02,
        "age_limit": 30,
        "ovr_limit": 60,
        "bonus_min": 7,
        "bonus_max": 10,
    },
    "ovr_hard_cap": 80,
}


def config_snapshot() -> dict[str, Any]:
    """Full Config constants for run metadata (static v41 manifest)."""
    return _V41_CONFIG
