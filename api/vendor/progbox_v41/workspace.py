"""Monorepo root resolution for vendored engine paths."""

from pathlib import Path

# api/vendor/progbox_v41/workspace.py → repo root (progbox_v41 → vendor → api → root)
REPO_ROOT: Path = Path(__file__).resolve().parent.parent.parent.parent
