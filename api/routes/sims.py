from typing import Annotated

from fastapi import APIRouter, HTTPException, Path

from models import RunMetadata
from services.storage import delete_run, get_run, list_runs

router = APIRouter()

BuildId = Annotated[
    str,
    Path(pattern=r"^\d{14}$", description="CalVer build id (YYYYMMDDHHmmss)"),
]


@router.get("")
async def list_sims() -> list[RunMetadata]:
    """List runs from `outputs/` (newest first)."""
    return list_runs()


@router.post("")
async def create_sim() -> dict[str, str]:
    """Start a simulation (Block 4)."""
    raise HTTPException(status_code=501, detail="POST /api/sims not implemented yet")


@router.get("/{build}/progress")
async def sim_progress_sse_placeholder(build: BuildId) -> dict[str, str]:
    """SSE progress stream (Block 4). Placeholder until implemented."""
    if get_run(build) is None:
        raise HTTPException(status_code=404, detail="Run not found")
    raise HTTPException(status_code=501, detail="SSE not implemented yet")


@router.get("/{build}/charts")
async def list_charts(build: BuildId) -> list[str]:
    """List chart PNG filenames (Block 1)."""
    if get_run(build) is None:
        raise HTTPException(status_code=404, detail="Run not found")
    return []


@router.delete("/{build}")
async def delete_sim(build: BuildId) -> dict[str, bool]:
    """Delete a run output directory."""
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
