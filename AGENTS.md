# Agent notes — progbox-ui

## Layout

- `web/` — Vue 3 + Vite + Tailwind v4. Dev server proxies `/api` → `http://127.0.0.1:8000`.
- `api/` — FastAPI. Run with `pnpm --filter @progbox/api dev` or `pnpm dev` (runs web + api in parallel).

## Commands (from repo root)

- `pnpm install` — install JS deps (workspace).
- `pnpm dev` — parallel dev: Vite + uvicorn.
- `pnpm check` — lint, typecheck, build, Python compile check.
- `pnpm doctor` — quick environment sanity check.
- `pip install -r api/requirements.txt` — Python API deps (once per venv).

## Conventions

- Prefer `ofetch` in `web/src/lib/api.ts` for HTTP.
- Simulation outputs live under `outputs/` (gitignored except `.gitkeep`).
- Do not modify upstream progbox Python modules when they are vendored here; wrap them from `api/services/runner.py` only.

## CI

- See `.github/workflows/ci.yml` for Node + Python checks.
