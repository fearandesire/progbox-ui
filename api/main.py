import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routes import config as config_routes
from routes import sims as sims_routes


def _cors_allow_origins() -> list[str]:
    raw = os.environ.get(
        "CORS_ALLOW_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173",
    )
    return [x.strip() for x in raw.split(",") if x.strip()]


def _cors_allow_credentials() -> bool:
    return os.environ.get("CORS_ALLOW_CREDENTIALS", "true").strip().lower() in (
        "1",
        "true",
        "yes",
    )


def validate_cors_config(origins: list[str], allow_credentials: bool) -> None:
    if allow_credentials and "*" in origins:
        msg = "Invalid CORS: allow_credentials=True cannot be used with origin '*'."
        raise RuntimeError(msg)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    yield


def create_app() -> FastAPI:
    origins = _cors_allow_origins()
    allow_credentials = _cors_allow_credentials()
    validate_cors_config(origins, allow_credentials)

    app = FastAPI(
        title="Progbox API",
        version="0.1.0",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=allow_credentials,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(sims_routes.router, prefix="/api/sims", tags=["sims"])
    app.include_router(config_routes.router, prefix="/api/config", tags=["config"])
    return app


app = create_app()
