# Agent notes — progbox-ui

This repository is the **UI + API** for Progbox Monte Carlo simulations. The **v4.1** Python engine is **vendored** at [`api/vendor/progbox_v41/`](api/vendor/progbox_v41/) (upstream: [akshayexists/progbox@dev-v4.1](https://github.com/akshayexists/progbox/tree/dev-v4.1)). Imports use `api/services/engine_adapter.py`; `api/main.py` also prepends the vendor dir to `sys.path` for multiprocessing workers and analysis.

## Layout

| Path | Role |
| --- | --- |
| `web/` | Vue 3 + Vite + Tailwind v4 SPA. Dev server proxies `/api` → `http://127.0.0.1:8000`. |
| `api/` | FastAPI app (`main.py`), routes (`routes/`), Pydantic models (`models.py`), services (`services/`). |
| `api/vendor/progbox_v41/` | Vendored engine: `progutils.py`, `runsim.py`, `analysis.py`, `exportcleaner.py`, `workspace.py`, `VERSION`. |
| `data/` | Default `export.json` / `teaminfo.json` for local runs when uploads omit teaminfo. |
| `outputs/` | File-backed run storage (gitignored except `outputs/.gitkeep`). Each run is **CalVer** `YYYYMMDDHHmmss` with `metadata.json`, `raw/`, `charts/`, `analysis.xlsx`. |
| `docs/` | Product plan and optional DX notes. |

## Implementation status

- **Runner:** [`api/services/runner.py`](api/services/runner.py) runs `exportcleaner` → `PROGEMUP` → `generate_analysis` under repo-root `cwd`, with phase progress in [`api/services/runner.py`](api/services/runner.py) `PROGRESS` dict.
- **API:** `POST /api/sims`, `GET /api/sims/{build}/progress` (SSE), `GET /api/sims/{build}/charts`, `GET /api/sims/{build}/charts/{name}`, `GET /api/sims/{build}/players`, `GET /api/sims/{build}/players/{pid}`, `GET /api/sims/{build}/godprogs`, `GET /api/sims/{build}/download?artifact=analysis|csv`, plus list/get/delete sims. See [`api/routes/sims.py`](api/routes/sims.py).
- **Config:** `GET /api/config` returns `script_version` + `config` snapshot from vendored `progutils.Config` via [`api/routes/config.py`](api/routes/config.py).
- **Artifacts:** [`api/services/sim_artifacts.py`](api/services/sim_artifacts.py) reads CSV, charts, godprogs from disk.
- **Testing:** The suite is intentionally split into `pytest` backend tests, `Vitest` frontend unit tests, and `Playwright` browser tests. Use `pnpm test` for the fast unit path, `pnpm test:api:engine` for the vendored-engine smoke run, and `pnpm test:e2e` / `pnpm test:e2e:full` for browser coverage. The living conventions are documented in [`TESTING.md`](TESTING.md).

## Commands (repo root)

- `pnpm install` — install JS workspace dependencies.
- `pnpm dev` — run **web + api** in parallel (`pnpm -r --parallel run dev`).
- `pnpm check` — ESLint, `vue-tsc`, web production build, Python `compileall` on `api/`.
- `pnpm test` — Vitest (web) + pytest (api), excluding the slow vendored-engine smoke test.
- `pnpm test:api:engine` — isolated vendored-engine smoke test.
- `pnpm test:e2e` — Playwright smoke suite.
- `pnpm test:e2e:full` — fuller seeded browser suite.
- `pnpm verify` — `check`, `test`, `test:api:engine`, then `test:e2e`.
- `pnpm verify:full` — `check`, `test`, `test:api:engine`, then `test:e2e:full`.
- `pnpm doctor` — quick Node/pnpm/`web/node_modules` sanity check (does not validate Python venv).
- Python API deps: `pip install -r api/requirements.txt` (use a venv).

## Conventions

- **HTTP client:** Use `ofetch` via [`web/src/lib/api.ts`](web/src/lib/api.ts). Browser default base is `/api`; override with `VITE_API_BASE_URL` when not using the Vite proxy.
- **Build IDs:** Canonical run id is **14 digits** `YYYYMMDDHHmmss` (CalVer). API validates this on `/api/sims/{build}` routes.
- **Outputs root:** Resolved by `api/services/storage.py`: env `PROGBOX_OUTPUTS_DIR`, else `<repo>/outputs/`.
- **Engine changes:** Prefer keeping vendored upstream files aligned with snapshots; minimal patches live in `runsim.py` (REPO_ROOT + worker `sys.path`) and `workspace.py`. Orchestration belongs in `api/services/runner.py`, not in routes.
- **Docs:** Keep [`README.md`](README.md) aligned with the command contract and keep [`TESTING.md`](TESTING.md) aligned with test-layer conventions.

## CI

- [`.github/workflows/ci.yml`](.github/workflows/ci.yml) — Node (lint, typecheck, build, Vitest coverage), Python (`compileall`, pytest coverage, engine smoke), and Playwright smoke/full jobs.

## Security / scope

- Intended for **local/trusted** use. CORS is env-driven; `allow_credentials` + wildcard origin `*` is rejected at startup.
