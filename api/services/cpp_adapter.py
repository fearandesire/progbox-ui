"""Python adapter that drives the C++ progbox binary as a subprocess."""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, Callable

from services import engine_adapter

_VENDOR_DIR = Path(__file__).resolve().parent.parent / "vendor" / "progbox_cpp"
_ANALYSIS_SCRIPT = _VENDOR_DIR / "tools" / "analysis.py"

# Candidate binary paths produced by CMake (platform order matters).
_BINARY_CANDIDATES = [
    _VENDOR_DIR / "build" / "progbox",
    _VENDOR_DIR / "build" / "progbox.exe",
    _VENDOR_DIR / "build" / "Release" / "progbox.exe",
    _VENDOR_DIR / "build" / "Release" / "progbox",
    _VENDOR_DIR / "build" / "x64" / "Release" / "progbox.exe",
    _VENDOR_DIR / "build" / "x64" / "Release" / "progbox",
]


def _normalize_season(raw_season: Any) -> int:
    """Return a valid integer season, defaulting for null or non-numeric values."""
    if type(raw_season) is int:
        return raw_season
    if isinstance(raw_season, str):
        try:
            return int(raw_season)
        except ValueError:
            return 2021
    return 2021


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


def _get_season(export_path: Path) -> int:
    """Extract the season year from the export's gameAttributes."""
    data: dict[str, Any] = json.loads(export_path.read_text(encoding="utf-8"))
    raw_season = data.get("gameAttributes", {}).get("season")
    return _normalize_season(raw_season)


def _filter_export(export_path: Path, teaminfo_path: Path, teams: list[str]) -> dict[str, Any]:
    """Return export JSON with players filtered to the requested teams."""
    data: dict[str, Any] = json.loads(export_path.read_text(encoding="utf-8"))
    if not teams:
        return data
    teaminfo: dict[str, str] = json.loads(teaminfo_path.read_text(encoding="utf-8"))
    allowed_tids = {int(tid) for tid, abbr in teaminfo.items() if abbr in teams}
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

    # exportcleaner writes data/input.csv relative to cwd; the chdir is scoped
    # and restored in finally. Not thread-safe, but runner.py serialises jobs.
    prev = os.getcwd()
    try:
        os.chdir(workspace)
        df, _ = ec_mod.exportcleaner(
            export_file=str(export_path.resolve()),
            teams=teams,
            teaminfo_file=str(teaminfo_path.resolve()),
        )
    finally:
        os.chdir(prev)

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


_PROGRESS_RE = re.compile(rb"(\d+)/(\d+)\s*\(\s*(\d+)\s*%\)")


def _stream_cpp_progress(
    proc: subprocess.Popen[bytes],
    callback: Callable[[float, str], None] | None,
) -> None:
    """Read C++ binary stdout and emit progress callbacks."""
    if callback is None:
        proc.stdout.read(4096)
        return

    buf = b""
    last_pct = -1
    is_tty = sys.stdout.isatty()

    while True:
        chunk = proc.stdout.read(4096)
        if not chunk:
            break
        buf += chunk
        lines = re.split(rb"[\r\n]", buf)
        buf = lines[-1]
        complete_lines = lines[:-1]

        for line in complete_lines:
            decoded = line.decode("utf-8", errors="replace").strip()
            if not decoded:
                continue

            if is_tty:
                sys.stdout.write(f"\r{decoded}")
                sys.stdout.flush()

            match = _PROGRESS_RE.search(line)
            if match:
                cpp_pct = int(match.group(3))
                if cpp_pct != last_pct:
                    last_pct = cpp_pct
                    callback(float(cpp_pct), decoded)

    if is_tty and buf:
        print(buf.decode("utf-8", errors="replace").strip())


def run_cpp_simulation(
    export_path: Path,
    teaminfo_path: Path,
    teams: list[str],
    seed: int,
    runs: int,
    n_workers: int,
    canonical_run_dir: Path,
    progress_callback: Callable[[float, str], None] | None = None,
    stage_callback: Callable[[str, str], None] | None = None,
) -> int:
    """Run the full C++ simulation pipeline and return the player count.

    stage_callback fires at post-simulation checkpoints with (stage_name, message):
    "cpp_done", "artifacts_copied", "analyzing", "analysis_done". Lets the runner
    surface progress for the otherwise-silent save + analysis work.
    """
    def _emit_stage(name: str, message: str) -> None:
        if stage_callback is not None:
            stage_callback(name, message)

    binary = _resolve_binary()
    cpp_outputs_base = canonical_run_dir / "_cpp_tmp_outputs"
    cpp_outputs_base.mkdir(parents=True, exist_ok=True)

    try:
        with tempfile.TemporaryDirectory(prefix="progbox_cpp_") as _ws:
            workspace = Path(_ws)

            player_count = _write_input_csv(workspace, export_path, teaminfo_path, teams)

            if teams:
                filtered = _filter_export(export_path, teaminfo_path, teams)
                effective_export = workspace / "export_filtered.json"
                effective_export.write_text(json.dumps(filtered), encoding="utf-8")
            else:
                effective_export = export_path

            season = _normalize_season(_get_season(export_path))
            cmd = [
                str(binary),
                str(effective_export.resolve()),
                str(teaminfo_path.resolve()),
                str(cpp_outputs_base.resolve()),
                "-v", "v41",
                "-r", str(runs),
                "-w", str(n_workers),
                "-s", str(seed),
                "-y", str(season),
            ]
            proc = subprocess.Popen(
                cmd, cwd=str(workspace),
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                bufsize=0,
            )
            try:
                _stream_cpp_progress(proc, progress_callback)
                returncode = proc.wait()
            finally:
                if proc.poll() is None:
                    proc.kill()
                    proc.wait()
            if returncode != 0:
                raise RuntimeError(f"C++ binary exited with code {returncode}")

            _emit_stage("cpp_done", "Saving workbook…")

            cpp_run_dir = _find_cpp_output_dir(cpp_outputs_base)
            raw_dst = canonical_run_dir / "raw"
            if raw_dst.exists():
                shutil.rmtree(raw_dst)
            shutil.copytree(cpp_run_dir / "raw", raw_dst)

            cpp_meta_src = cpp_run_dir / "metadata.json"
            if cpp_meta_src.is_file():
                shutil.copy2(cpp_meta_src, canonical_run_dir / "engine_metadata.json")

            _emit_stage("artifacts_copied", "Copied artifacts.")

            # PYTHONUTF8=1 avoids cp1252 crashes on Windows when analysis.py
            # prints box-drawing chars. Non-zero exit is a warning (matches the
            # C++ binary) so tiny filtered runs without enough players for
            # scipy KDE still produce a valid "complete" simulation.
            analysis_env = {**os.environ, "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8"}
            _emit_stage("analyzing", "Generating analysis…")
            analysis_result = subprocess.run(
                [sys.executable, str(_ANALYSIS_SCRIPT.resolve()), str(canonical_run_dir.resolve())],
                cwd=str(workspace),
                env=analysis_env,
            )
            if analysis_result.returncode != 0:
                print(
                    f"Warning: tools/analysis.py exited with code "
                    f"{analysis_result.returncode} (analysis_dashboard.html may be incomplete)",
                    flush=True,
                )
            _emit_stage("analysis_done", "Analysis complete.")
    finally:
        shutil.rmtree(cpp_outputs_base, ignore_errors=True)

    return player_count
