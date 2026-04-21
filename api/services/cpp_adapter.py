"""Python adapter that drives the C++ progbox binary as a subprocess."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

from services import engine_adapter

_VENDOR_DIR = Path(__file__).resolve().parent.parent / "vendor" / "progbox_cpp"
_ANALYSIS_SCRIPT = _VENDOR_DIR / "tools" / "analysis.py"

# Candidate binary paths produced by buildprogbox.sh (platform order matters).
_BINARY_CANDIDATES = [
    _VENDOR_DIR / "build" / "progbox",
    _VENDOR_DIR / "build" / "progbox.exe",
    _VENDOR_DIR / "build" / "Release" / "progbox.exe",
    _VENDOR_DIR / "build" / "Release" / "progbox",
]


def _resolve_binary() -> Path:
    """Return the C++ binary path, respecting PROGBOX_CPP_BINARY override."""
    override = os.environ.get("PROGBOX_CPP_BINARY")
    if override:
        p = Path(override)
        if not p.is_file():
            raise FileNotFoundError(
                f"PROGBOX_CPP_BINARY={override!r} does not exist"
            )
        return p
    for candidate in _BINARY_CANDIDATES:
        if candidate.is_file():
            return candidate
    raise FileNotFoundError(
        "C++ progbox binary not found. "
        "Run `pnpm build:engine` or set PROGBOX_CPP_BINARY."
    )


def _filter_export(export_path: Path, teams: list[str]) -> dict[str, Any]:
    """Return export JSON with players filtered to the requested teams."""
    data: dict[str, Any] = json.loads(export_path.read_text(encoding="utf-8"))
    if not teams:
        return data
    teaminfo: dict[str, str] = data.get("teaminfo", {})
    allowed_tids = {
        int(tid) for tid, abbr in teaminfo.items() if abbr in teams
    }
    data["players"] = [
        p for p in data.get("players", [])
        if p.get("tid") in allowed_tids
    ]
    return data


def _write_input_csv(workspace: Path, export_path: Path, teaminfo_path: Path, teams: list[str]) -> int:
    """Parse export with the vendored exportcleaner and write data/input.csv.

    Returns player_count after filtering.
    """
    ec_mod = engine_adapter.load_exportcleaner_module()
    (workspace / "data").mkdir(parents=True, exist_ok=True)

    # exportcleaner writes data/input.csv relative to cwd
    import os as _os
    prev = _os.getcwd()
    try:
        _os.chdir(workspace)
        df, _ = ec_mod.exportcleaner(
            export_file=str(export_path.resolve()),
            teams=teams,
            teaminfo_file=str(teaminfo_path.resolve()),
        )
    finally:
        _os.chdir(prev)

    df.to_csv(workspace / "data" / "input.csv")
    return int(len(df))


def _find_cpp_output_dir(base: Path) -> Path:
    """Find the single timestamped directory the C++ binary created inside *base*."""
    subdirs = [p for p in base.iterdir() if p.is_dir()]
    if len(subdirs) != 1:
        raise RuntimeError(
            f"Expected exactly 1 C++ output directory in {base}, "
            f"found {len(subdirs)}: {[p.name for p in subdirs]}"
        )
    return subdirs[0]


def run_cpp_simulation(
    build: str,
    export_path: Path,
    teaminfo_path: Path,
    teams: list[str],
    seed: int,
    runs: int,
    n_workers: int,
    canonical_run_dir: Path,
) -> int:
    """Run the full C++ simulation pipeline.

    Steps:
      1. Resolve binary.
      2. Create isolated temp workspace.
      3. Filter export (if teams specified) and write data/input.csv.
      4. Invoke C++ binary → it creates a timestamped subdir with raw/.
      5. Copy raw/ into canonical_run_dir/raw/.
      6. Preserve C++ metadata as engine_metadata.json.
      7. Run tools/analysis.py under sys.executable from temp workspace.

    Returns:
      player_count — number of players loaded by exportcleaner.
    """
    binary = _resolve_binary()
    cpp_outputs_base = canonical_run_dir / "_cpp_tmp_outputs"
    cpp_outputs_base.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="progbox_cpp_") as _ws:
        workspace = Path(_ws)

        # ── Step 3: write data/input.csv (also does team-filtering for analysis) ──
        player_count = _write_input_csv(workspace, export_path, teaminfo_path, teams)

        # ── Step 3b: write filtered export.json if teams specified ─────────────
        if teams:
            filtered = _filter_export(export_path, teams)
            effective_export = workspace / "export_filtered.json"
            effective_export.write_text(json.dumps(filtered), encoding="utf-8")
        else:
            effective_export = export_path

        # ── Step 4: invoke C++ binary ──────────────────────────────────────────
        cmd = [
            str(binary),
            str(effective_export.resolve()),
            str(teaminfo_path.resolve()),
            str(cpp_outputs_base.resolve()),
            "-v", "v41",
            "-r", str(runs),
            "-w", str(n_workers),
            "-s", str(seed),
            "-y", "2021",
        ]
        result = subprocess.run(
            cmd,
            cwd=str(workspace),
        )
        if result.returncode != 0:
            raise RuntimeError(
                f"C++ binary exited with code {result.returncode}"
            )

        # ── Step 5: locate timestamped subdir and copy raw/ ────────────────────
        cpp_run_dir = _find_cpp_output_dir(cpp_outputs_base)
        raw_src = cpp_run_dir / "raw"
        raw_dst = canonical_run_dir / "raw"
        if raw_dst.exists():
            shutil.rmtree(raw_dst)
        shutil.copytree(raw_src, raw_dst)

        # ── Step 6: preserve C++ metadata ─────────────────────────────────────
        cpp_meta_src = cpp_run_dir / "metadata.json"
        if cpp_meta_src.is_file():
            shutil.copy2(cpp_meta_src, canonical_run_dir / "engine_metadata.json")

        # ── Step 7: run analysis.py from workspace (finds data/input.csv) ──────
        # PYTHONUTF8=1 forces UTF-8 I/O so box-drawing chars in the script's
        # output don't crash on Windows with a cp1252 console encoding.
        # Non-zero exit is treated as a warning (matching the C++ binary's own
        # behaviour) so that small filtered runs with too few players for scipy
        # KDE still produce a valid "complete" simulation.
        analysis_env = {**os.environ, "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8"}
        analysis_result = subprocess.run(
            [sys.executable, str(_ANALYSIS_SCRIPT.resolve()), str(canonical_run_dir.resolve())],
            cwd=str(workspace),
            env=analysis_env,
        )
        if analysis_result.returncode != 0:
            print(
                f"Warning: tools/analysis.py exited with code "
                f"{analysis_result.returncode} (charts/xlsx may be incomplete)",
                flush=True,
            )

    # Clean up temporary C++ outputs base directory
    if cpp_outputs_base.exists():
        shutil.rmtree(cpp_outputs_base, ignore_errors=True)

    return player_count
