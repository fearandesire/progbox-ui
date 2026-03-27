from fastapi import APIRouter

router = APIRouter()


@router.get("")
async def get_config():
    """Serve progutils.Config constants when engine is wired (Block 1)."""
    return {"message": "pending_implementation"}
