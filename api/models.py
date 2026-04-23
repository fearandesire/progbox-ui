from typing import Any, Literal

from pydantic import BaseModel, Field


class RunMetadata(BaseModel):
    build: str
    script_version: str | None = None
    status: str = "unknown"
    teams: list[str] = Field(default_factory=list)
    seed: int | None = None
    runs: int | None = None
    n_workers: int | None = None
    export_file: str | None = None
    teaminfo_file: str | None = None
    # "generated" = derived from the uploaded export at POST /api/sims;
    # "user" = the caller uploaded their own teaminfo.json to override.
    teaminfo_source: Literal["generated", "user"] = "generated"
    started_at: str | None = None
    completed_at: str | None = None
    player_count: int | None = None
    config_snapshot: dict[str, Any] | None = None
    error: str | None = None
