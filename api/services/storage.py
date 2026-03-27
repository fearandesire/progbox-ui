from __future__ import annotations

import json
import os
import shutil
from pathlib import Path

from build_id import BUILD_ID_PATTERN
from models import RunMetadata


def repo_root() -> Path:
    """Repository root (directory containing `api/`)."""
    return Path(__file__).resolve().parent.parent.parent


def outputs_root() -> Path:
    """Resolved `outputs/` directory (env override or repo-relative)."""
    override = os.environ.get("PROGBOX_OUTPUTS_DIR", "").strip()
    if override:
        return Path(override).expanduser().resolve()
    return (repo_root() / "outputs").resolve()


def _metadata_path(build: str) -> Path:
    return outputs_root() / build / "metadata.json"


def list_runs() -> list[RunMetadata]:
    """Scan `outputs/` for valid CalVer dirs with metadata.json."""
    root = outputs_root()
    if not root.is_dir():
        return []
    runs: list[RunMetadata] = []
    for child in sorted(root.iterdir(), key=lambda p: p.name, reverse=True):
        if not child.is_dir():
            continue
        if not BUILD_ID_PATTERN.match(child.name):
            continue
        meta = child / "metadata.json"
        if not meta.is_file():
            continue
        loaded = get_run(child.name)
        if loaded:
            runs.append(loaded)
    return runs


def get_run(build: str) -> RunMetadata | None:
    """Load a single run by CalVer build id."""
    if not BUILD_ID_PATTERN.match(build):
        return None
    path = _metadata_path(build)
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return RunMetadata.model_validate(data)
    except (OSError, json.JSONDecodeError, ValueError):
        return None


def delete_run(build: str) -> bool:
    """Remove an output directory. Returns True if something was deleted."""
    if not BUILD_ID_PATTERN.match(build):
        return False
    target = outputs_root() / build
    if not target.is_dir():
        return False
    shutil.rmtree(target)
    return True
