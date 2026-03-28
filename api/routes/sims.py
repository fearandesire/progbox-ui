from __future__ import annotations

import asyncio
import json
import os
from datetime import datetime, timezone
from typing import Annotated, Any

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, Path, Query, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field

from models import RunMetadata
from services import engine_adapter
from services.runner import PROGRESS, run_simulation_job
from services.sim_artifacts import (
    analysis_xlsx_path,
    chart_path,
    godprogs_records,
    list_chart_filenames,
    player_all_runs,
    player_summaries,
    raw_outputs_csv_path,
)
from services.storage import delete_run, get_run, list_runs, outputs_root, repo_root

router = APIRouter()

BuildId = Annotated[
    str,
    Path(pattern=r"^\d{14}$", description="CalVer build id (YYYYMMDDHHmmss)"),
]


class SimCreateBody(BaseModel):
    teams: list[str] = Field(default_factory=list)
    seed: int = 69
    runs: int = 500
    n_workers: int | None = None


def _new_build_id() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


@router.get("")
async def list_sims() -> list[RunMetadata]:
    """List runs from `outputs/` (newest first)."""
    return list_runs()


@router.post("")
async def create_sim(
    background_tasks: BackgroundTasks,
    export: UploadFile = File(..., description="League export JSON"),
    config: str = Form(..., description="JSON body: teams, seed, runs, n_workers"),
    teaminfo: UploadFile | None = File(default=None, description="Optional teaminfo.json"),
) -> dict[str, str]:
    """Upload export (+ optional teaminfo) and start a simulation."""
    body = SimCreateBody.model_validate_json(config)
    cpu = os.cpu_count() or 1
    n_workers = body.n_workers if body.n_workers is not None else max(cpu - 1, 1)
    if n_workers < 1:
        raise HTTPException(status_code=422, detail="n_workers must be >= 1")

    build = _new_build_id()
    out = outputs_root() / build
    out.mkdir(parents=True, exist_ok=True)

    export_bytes = await export.read()
    if not export_bytes:
        raise HTTPException(status_code=422, detail="export file is empty")

    export_path = out / "export.json"
    export_path.write_bytes(export_bytes)

    if teaminfo is not None:
        teaminfo_bytes = await teaminfo.read()
        if not teaminfo_bytes:
            raise HTTPException(status_code=422, detail="teaminfo file is empty")
    else:
        default_teaminfo = repo_root() / "data" / "teaminfo.json"
        if not default_teaminfo.is_file():
            raise HTTPException(
                status_code=500,
                detail="No teaminfo upload and data/teaminfo.json is missing",
            )
        teaminfo_bytes = default_teaminfo.read_bytes()

    teaminfo_path = out / "teaminfo.json"
    teaminfo_path.write_bytes(teaminfo_bytes)

    meta = {
        "build": build,
        "script_version": engine_adapter.script_version(),
        "teams": body.teams,
        "seed": body.seed,
        "runs": body.runs,
        "n_workers": n_workers,
        "export_file": f"outputs/{build}/export.json",
        "teaminfo_file": f"outputs/{build}/teaminfo.json",
        "status": "running",
        "started_at": _utc_now_iso(),
        "completed_at": None,
        "player_count": None,
        "config_snapshot": engine_adapter.config_snapshot(),
        "error": None,
    }
    (out / "metadata.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")

    background_tasks.add_task(
        run_simulation_job,
        build,
        export_path,
        teaminfo_path,
        body.teams,
        body.seed,
        body.runs,
        n_workers,
    )
    return {"build": build}


@router.get("/{build}/progress")
async def sim_progress_sse(build: BuildId) -> StreamingResponse:
    """SSE stream: JSON lines `{ phase, pct, message, done }`."""
    if get_run(build) is None:
        raise HTTPException(status_code=404, detail="Run not found")

    async def event_stream():
        while True:
            run = get_run(build)
            st = PROGRESS.get(build)
            if st:
                payload = {"phase": st["phase"], "pct": st["pct"], "message": st["message"], "done": st["done"]}
                yield f"data: {json.dumps(payload)}\n\n"
                if st.get("done"):
                    break
                await asyncio.sleep(0.35)
                continue

            if run is None:
                yield f"data: {json.dumps({'phase': 'error', 'pct': 0, 'message': 'Run not found', 'done': True})}\n\n"
                break
            if run.status == "complete":
                yield f"data: {json.dumps({'phase': 'complete', 'pct': 100, 'message': 'Complete', 'done': True})}\n\n"
                break
            if run.status == "failed":
                yield f"data: {json.dumps({'phase': 'failed', 'pct': 0, 'message': run.error or 'Failed', 'done': True})}\n\n"
                break
            yield f"data: {json.dumps({'phase': 'running', 'pct': 0, 'message': 'Starting…', 'done': False})}\n\n"
            await asyncio.sleep(0.35)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )


@router.get("/{build}/charts")
async def list_charts(build: BuildId) -> list[str]:
    """List chart PNG filenames."""
    if get_run(build) is None:
        raise HTTPException(status_code=404, detail="Run not found")
    return list_chart_filenames(build)


@router.get("/{build}/charts/{name}")
async def get_chart_png(build: BuildId, name: str) -> FileResponse:
    if get_run(build) is None:
        raise HTTPException(status_code=404, detail="Run not found")
    try:
        path = chart_path(build, name)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Chart not found")
    return FileResponse(path, media_type="image/png", filename=name)


@router.get("/{build}/players")
async def list_players(build: BuildId) -> list[dict[str, Any]]:
    if get_run(build) is None:
        raise HTTPException(status_code=404, detail="Run not found")
    try:
        return player_summaries(build)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="outputs.csv not found yet") from exc


@router.get("/{build}/players/{pid}")
async def get_player(build: BuildId, pid: str) -> list[dict[str, Any]]:
    if get_run(build) is None:
        raise HTTPException(status_code=404, detail="Run not found")
    try:
        rows = player_all_runs(build, pid)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="outputs.csv not found yet") from exc
    if not rows:
        raise HTTPException(status_code=404, detail="Player not found")
    return rows


@router.get("/{build}/godprogs")
async def list_godprogs(build: BuildId) -> list[dict[str, Any]]:
    if get_run(build) is None:
        raise HTTPException(status_code=404, detail="Run not found")
    return godprogs_records(build)


@router.get("/{build}/download")
async def download_artifact(
    build: BuildId,
    artifact: Annotated[str, Query(description="analysis|csv")] = "analysis",
) -> FileResponse:
    if get_run(build) is None:
        raise HTTPException(status_code=404, detail="Run not found")
    if artifact in ("analysis", "xlsx", "analysis.xlsx"):
        path = analysis_xlsx_path(build)
        if not path.is_file():
            raise HTTPException(status_code=404, detail="analysis.xlsx not found")
        return FileResponse(
            path,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            filename="analysis.xlsx",
        )
    if artifact in ("csv", "raw", "outputs.csv"):
        path = raw_outputs_csv_path(build)
        if not path.is_file():
            raise HTTPException(status_code=404, detail="outputs.csv not found")
        return FileResponse(path, media_type="text/csv", filename="outputs.csv")
    raise HTTPException(status_code=422, detail="Invalid file query (use analysis or csv)")


@router.delete("/{build}")
async def delete_sim(build: BuildId) -> dict[str, bool]:
    """Delete a run output directory."""
    PROGRESS.pop(build, None)
    if not delete_run(build):
        raise HTTPException(status_code=404, detail="Run not found")
    return {"ok": True}


@router.get("/{build}")
async def get_sim(build: BuildId) -> RunMetadata:
    """Single run metadata."""
    run = get_run(build)
    if run is None:
        raise HTTPException(status_code=404, detail="Run not found")
    return run
