# Archive

## Week of 2026-05-11
Rebuilt WSL environment (venv, Python/Node deps, C++ engine); build succeeded but pnpm dev failed (uvicorn import error, missing node_modules).

## Week of 2026-05-18
Fixed venv activation, cloned progbox-ui to WSL. Implemented teaminfo auto-gen service (BBGM exports) with full integration (routes/models/UI/tests/docs). Debugged kagan orchestrator init error (WinError 2, root cause missing pyproject.toml). CodeRabbit flagged 9 progbox_cpp issues (OOB array access, shell injection, unguarded JSON parse, quantile underflow, int/float mismatch).