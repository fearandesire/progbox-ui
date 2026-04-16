from fastapi import APIRouter

from services import engine_adapter

router = APIRouter()


@router.get("")
async def get_config() -> dict:
    """Read-only `progutils.Config` snapshot + script version."""
    return {
        "script_version": engine_adapter.script_version(),
        "config": engine_adapter.config_snapshot(),
    }
