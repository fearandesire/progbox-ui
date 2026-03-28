# Agent notes — progbox-ui

This repository is the **UI + API shell** for [progbox](https://github.com/akshayexists/progbox) (Monte Carlo engine). The Python engine sources (`progutils.py`, `runsim.py`, `analysis.py`, `exportcleaner.py`, etc.) **live in the upstream progbox repo**, not in this tree unless you add them deliberately (submodule, sibling checkout, or copy).

## Layout

| Path | Role |
| --- | --- |
| `web/` | Vue 3 + Vite + Tailwind v4 SPA. Dev server proxies `/api` → `http://127.0.0.1:8000`. |
| `api/` | FastAPI app (`main.py`), routes (`routes/`), Pydantic models (`models.py`), services (`services/`). |
| `outputs/` | File-backed run storage (gitignored except `outputs/.gitkeep`). Each run is a **CalVer** directory name: `YYYYMMDDHHmmss`, containing `metadata.json` and (when implemented) artifacts from the pipeline. |
| `docs/` | Product plan and optional DX notes. |

## Current implementation status (do not assume engine is wired)

- **Implemented (API):** `GET /api/sims` (list from `outputs/`), `GET /api/sims/{build}` (single `metadata.json`), `DELETE /api/sims/{build}`, `GET /api/sims/{build}/charts` (returns `[]` until chart discovery exists), `GET /api/sims/{build}/progress` (**501** placeholder for future SSE). Storage: [`api/services/storage.py`](api/services/storage.py).
- **Not implemented yet:** `POST /api/sims` (**501**), player/godprog/download/chart-PNG routes from the product plan, real SSE progress, and anything that parses CSV/XLSX from disk beyond `metadata.json`.
- **Runner:** [`api/services/runner.py`](api/services/runner.py) is a **stub** (`NotImplementedError`). Full pipeline requires upstream progbox imports (see README).
- **Config API:** `GET /api/config` is a **stub** until it reads real `progutils.Config` from an importable engine package.
- **Engine:** No `progutils.py` in this repo by default. Full simulations require integrating the upstream engine on `PYTHONPATH` (or equivalent).

## Commands (repo root)

- `pnpm install` — install JS workspace dependencies.
- `pnpm dev` — run **web + api** in parallel (`pnpm -r --parallel run dev`).
- `pnpm check` — ESLint, `vue-tsc`, web production build, Python `compileall` on `api/`.
- `pnpm test` — Vitest (web) + pytest (api).
- `pnpm verify` — `check` then `test`.
- `pnpm doctor` — quick Node/pnpm/`web/node_modules` sanity check (does not validate Python venv).
- Python API deps: `pip install -r api/requirements.txt` (use a venv).

## Conventions

- **HTTP client:** Use `ofetch` via [`web/src/lib/api.ts`](web/src/lib/api.ts). Browser default base is `/api`; override with `VITE_API_BASE_URL` when not using the Vite proxy.
- **Build IDs:** Canonical run id is **14 digits** `YYYYMMDDHHmmss` (CalVer). API validates this on `/api/sims/{build}` routes.
- **Outputs root:** Resolved by `api/services/storage.py`: env `PROGBOX_OUTPUTS_DIR`, else `<repo>/outputs/`.
- **Engine changes:** Do **not** edit upstream engine files in place if they are vendored; prefer wrapping imports in `api/services/runner.py` and keeping diffs in this repo only for the FastAPI layer. If the engine is not present, document the integration step instead of inventing inline logic in routes.

## CI

- [`.github/workflows/ci.yml`](.github/workflows/ci.yml) — Node (lint, typecheck, build, Vitest) and Python (install, `compileall`, pytest).

## Security / scope

- Intended for **local/trusted** use. CORS is env-driven; `allow_credentials` + wildcard origin `*` is rejected at startup.
