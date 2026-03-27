from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from main import app, validate_cors_config


def test_validate_cors_rejects_wildcard_with_credentials() -> None:
    with pytest.raises(RuntimeError):
        validate_cors_config(["*"], True)


def test_validate_cors_allows_explicit_origins() -> None:
    validate_cors_config(["http://localhost:5173"], True)


def test_config_route_ok() -> None:
    c = TestClient(app)
    r = c.get("/api/config")
    assert r.status_code == 200
    assert "message" in r.json()
