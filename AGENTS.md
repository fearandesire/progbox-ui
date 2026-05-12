# Agent notes — progbox-ui

This repository is the **UI + API** for Progbox Monte Carlo simulations. The **active simulation backend** is the vendored **C++** engine at [`api/vendor/progbox_cpp/`](api/vendor/progbox_cpp/). Build it with `pnpm build:engine` (see [`README.md`](README.md)); runtime resolution is in [`api/services/cpp_adapter.py`](api/services/cpp_adapter.py). Vendored **Python v4.1** helpers live at [`api/vendor/progbox_v41/`](api/vendor/progbox_v41/) (upstream: [akshayexists/progbox@dev-v4.1](https://github.com/akshayexists/progbox/tree/dev-v4.1)) and are used for `exportcleaner` via [`api/services/engine_adapter.py`](api/services/engine_adapter.py). `api/main.py` prepends the Python vendor dir to `sys.path` where needed for imports.

## Layout

| Path | Role |
| --- | --- |
| `web/` | Vue 3 + Vite + Tailwind v4 SPA. Dev server proxies `/api` → `http://127.0.0.1:8000`. |
| `api/` | FastAPI app (`main.py`), routes (`routes/`), Pydantic models (`models.py`), services (`services/`). |
| `api/vendor/progbox_cpp/` | Vendored C++ engine source; build output under `api/vendor/progbox_cpp/build/` (gitignored). |
| `api/vendor/progbox_v41/` | Vendored Python helpers: `exportcleaner.py`, `progutils.py`-era modules, `VERSION`. |
| `data/` | Default `export.json` for local runs. `teaminfo.json` is auto-generated from each upload by [`api/services/teaminfo.py`](api/services/teaminfo.py); users may upload an override for custom leagues. |
| `outputs/` | File-backed run storage (gitignored except `outputs/.gitkeep`). Each run is **CalVer** `YYYYMMDDHHmmss` with `metadata.json`, `raw/` (`outputs.csv`, `godprogs.json`), `analysis.xlsx`, `analysis_dashboard.html`, optional `charts/*.png`, optional `engine_metadata.json`. |
| `docs/` | Product plan and optional DX notes. |

## Implementation status

- **Runner:** [`api/services/runner.py`](api/services/runner.py) runs `exportcleaner` (Python) → C++ `progbox` subprocess (via [`api/services/cpp_adapter.py`](api/services/cpp_adapter.py)) → post-run `tools/analysis.py`, with phase progress in [`api/services/runner.py`](api/services/runner.py) `PROGRESS` dict.
- **API:** `POST /api/sims`, `GET /api/sims/{build}/progress` (SSE), `GET /api/sims/{build}/charts`, `GET /api/sims/{build}/charts/{name}`, `GET /api/sims/{build}/players`, `GET /api/sims/{build}/players/{pid}`, `GET /api/sims/{build}/godprogs`, `GET /api/sims/{build}/download?artifact=analysis|csv`, plus list/get/delete sims. See [`api/routes/sims.py`](api/routes/sims.py).
- **Config:** `GET /api/config` returns `script_version` + static config snapshot via [`api/routes/config.py`](api/routes/config.py) / [`api/services/engine_adapter.py`](api/services/engine_adapter.py).
- **Artifacts:** [`api/services/sim_artifacts.py`](api/services/sim_artifacts.py) reads CSV, optional chart PNGs, godprogs from disk.
- **Testing:** The suite is intentionally split into `pytest` backend tests, `Vitest` frontend unit tests, and `Playwright` browser tests. Use `pnpm test` for the fast unit path, `pnpm test:api:engine` for the vendored-engine smoke run, and `pnpm test:e2e` / `pnpm test:e2e:full` for browser coverage. The living conventions are documented in [`TESTING.md`](TESTING.md).

## Commands (repo root)

- `pnpm install` — install JS workspace dependencies.
- `pnpm build:engine` — compile the vendored C++ engine (CMake); required before real sims unless `PROGBOX_CPP_BINARY` is set.
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
- **Engine changes:** Prefer keeping vendored upstream files aligned with snapshots; orchestration belongs in `api/services/runner.py` and `api/services/cpp_adapter.py`, not in routes. Python vendor tweaks stay minimal (exportcleaner / path glue).
- **Docs:** Keep [`README.md`](README.md) aligned with the command contract and keep [`TESTING.md`](TESTING.md) aligned with test-layer conventions.

## CI

- [`.github/workflows/ci.yml`](.github/workflows/ci.yml) — Node (lint, typecheck, build, Vitest coverage), Python (`compileall`, pytest coverage, engine smoke), and Playwright smoke/full jobs.

## Security / scope

- Intended for **local/trusted** use. CORS is env-driven; `allow_credentials` + wildcard origin `*` is rejected at startup.

## Cursor Cloud specific instructions

### Environment

- **Node 22**, **Python 3.12**, **pnpm 10.8.0** — all pre-installed via the update script.
- Python venv lives at `.venv` in the repo root. Activate it (`source .venv/bin/activate`) before running any `pnpm` command that touches the API (e.g. `pnpm dev`, `pnpm test`, `pnpm check`).
- No external services (database, cache, message broker) are required — all storage is file-backed under `outputs/`.

### Running dev servers

- `source .venv/bin/activate && pnpm dev` starts both Vite (`:5173`) and Uvicorn (`:8000`) in parallel.
- The Vite dev server binds to **IPv6 `localhost`** by default. The Playwright config checks `127.0.0.1:5173` (IPv4), which won't match a running `pnpm dev` Vite instance. Therefore, **stop `pnpm dev` before running `pnpm test:e2e`** — Playwright will start its own servers with `--host 127.0.0.1` and manage their lifecycle.

### Running tests

- `pnpm test` (Vitest + pytest) and `pnpm test:api:engine` (engine smoke) can run with or without dev servers.
- `pnpm test:e2e` / `pnpm test:e2e:full`: **ports 5173 and 8000 must be free**. Playwright starts its own servers via the `webServer` config. If ports are occupied, the Vite webServer picks a different port and Playwright times out waiting on 5173.
- `pnpm check` runs ESLint, `vue-tsc`, production build, and `compileall` — needs venv active for the Python step.

### Hello-world smoke test

To validate the full pipeline via the API:
```bash
source .venv/bin/activate && pnpm dev &   # start servers
curl -s -X POST http://127.0.0.1:8000/api/sims \
  -F "export=@data/export.json" \
  -F 'config={"teams":[],"seed":42,"runs":10,"n_workers":1}'
# Wait ~15s, then:
curl -s http://127.0.0.1:8000/api/sims | jq '.[0].status'  # → "complete"
```
