"""Development server for the FastAPI app.

Uvicorn's ``--reload-exclude <dir>`` uses ``exclude_dir in path.parents``. A
relative ``tests`` path does not match absolute ``path.parents`` entries on
Windows, so test edits still trigger reloads. Passing an absolute ``tests``
path makes excludes work and keeps ``pnpm dev`` (web + api parallel) stable.
"""

from __future__ import annotations

from pathlib import Path

import uvicorn

_ROOT = Path(__file__).resolve().parent


if __name__ == "__main__":
    tests_dir = _ROOT / "tests"
    excludes: list[str] = [str(tests_dir)] if tests_dir.is_dir() else []
    uvicorn.run(
        "main:app",
        host="127.0.0.1",
        port=8000,
        reload=True,
        reload_excludes=excludes,
    )
