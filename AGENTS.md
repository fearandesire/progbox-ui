# Agent notes — progbox-ui

This repository is the **UI + API** for Progbox Monte Carlo simulations. The **active simulation backend** is the vendored **C++** engine at [`api/vendor/progbox_cpp/`](api/vendor/progbox_cpp/). Build it with `pnpm build:engine` (see [`README.md`](README.md)); runtime resolution is in [`api/src/services/cppAdapter.ts`](api/src/services/cppAdapter.ts). Export cleaning, teaminfo generation, and analysis workbook/HTML output are implemented in **TypeScript** under [`api/src/services/`](api/src/services/) (ported from the former Python `exportcleaner` / `analysis.py` flow).

## Layout

| Path | Role |
| --- | --- |
| `web/` | Vue 3 + Vite + Tailwind v4 SPA. Dev server proxies `/api` → `http://127.0.0.1:8000`. |
| `api/` | TypeScript **Fastify** API (`src/server.ts`, `src/app.ts`), routes under `src/routes/`, services under `src/services/`. |
| `api/vendor/progbox_cpp/` | Vendored C++ engine source; build output under `api/vendor/progbox_cpp/build/` (gitignored). |
| `data/` | Default `export.json` for local runs. `teaminfo.json` is auto-generated from each upload by [`api/src/services/teaminfo.ts`](api/src/services/teaminfo.ts); users may upload an override for custom leagues. |
| `outputs/` | File-backed run storage (gitignored except `outputs/.gitkeep`). Each run is **CalVer** `YYYYMMDDHHmmss` with `metadata.json`, `raw/` (`outputs.csv`, `godprogs.json`), `analysis.xlsx`, `analysis_dashboard.html`, optional `charts/*.png`, optional `engine_metadata.json`. |
| `docs/` | Product plan and optional DX notes. |

## Implementation status

- **Runner:** [`api/src/services/runner.ts`](api/src/services/runner.ts) drives C++ `progbox` via [`api/src/services/cppAdapter.ts`](api/src/services/cppAdapter.ts), merges metadata (patched from the engine's own `engine_metadata.json`), and generates post-run analysis via the vendored Python post-processor [`api/src/services/analysisPython.ts`](api/src/services/analysisPython.ts) (interactive Plotly dashboard + workbook), falling back to the TypeScript stub [`api/src/services/analysisGenerate.ts`](api/src/services/analysisGenerate.ts) when Python is unavailable. Progress for SSE lives in [`api/src/services/progress.ts`](api/src/services/progress.ts).
- **API:** `POST /api/sims` (per-run `version` = `v41`/`v43`, plus a `compare` flag — default on — that also runs the other version with identical inputs and links the two as a pair; response then includes `compare_build` + `pair_id`), `GET /api/sims/compare?builds=a,b` (head-to-head comparison dashboard for 2+ completed runs, cached), `GET /api/sims/{build}/progress` (SSE), charts, players, godprogs, analysis HTML, downloads, list/get/delete — see [`api/src/routes/sims.ts`](api/src/routes/sims.ts).
- **Config:** `GET /api/config` returns the engine build id + available progression versions via [`api/src/routes/config.ts`](api/src/routes/config.ts) / [`api/src/services/engineAdapter.ts`](api/src/services/engineAdapter.ts).
- **Artifacts:** [`api/src/services/simArtifacts.ts`](api/src/services/simArtifacts.ts) reads CSV, optional chart PNGs, godprogs from disk.
- **Testing:** Vitest for `web/` and `api/`, plus Playwright. Use `pnpm test` for the fast unit path, `pnpm test:api:engine` for the vendored-engine smoke run, and `pnpm test:e2e` / `pnpm test:e2e:full` for browser coverage. Conventions: [`TESTING.md`](TESTING.md).

## Commands (repo root)

- `pnpm install` — install JS workspace dependencies.
- `pnpm build:engine` — compile the vendored C++ engine (CMake); required before real sims unless `PROGBOX_CPP_BINARY` is set.
- `pnpm dev` — run **web + api** in parallel (`pnpm -r --parallel run dev`).
- `pnpm check` — ESLint, `vue-tsc`, web production build, and `pnpm run lint:api` (`tsc --noEmit` in `api/`).
- `pnpm test` — Vitest (web + api), excluding the slow vendored-engine smoke test.
- `pnpm test:api:engine` — isolated vendored-engine smoke test (`api/src/engine.smoke.engine.test.ts`).
- `pnpm test:e2e` — Playwright smoke suite.
- `pnpm test:e2e:full` — fuller seeded browser suite.
- `pnpm verify` — `check`, `test`, `test:api:engine`, then `test:e2e`.
- `pnpm verify:full` — `check`, `test`, `test:api:engine`, then `test:e2e:full`.
- `pnpm doctor` — quick Node/pnpm/`web/node_modules` sanity check.

## Conventions

- **HTTP client:** Use `ofetch` via [`web/src/lib/api.ts`](web/src/lib/api.ts). Browser default base is `/api`; override with `VITE_API_BASE_URL` when not using the Vite proxy.
- **Build IDs:** Canonical run id is **14 digits** `YYYYMMDDHHmmss` (CalVer). API validates this on `/api/sims/{build}` routes.
- **Outputs root:** Resolved by `api/src/paths.ts`: env `PROGBOX_OUTPUTS_DIR`, else `<repo>/outputs/`.
- **Engine changes:** Prefer keeping vendored upstream C++ aligned with snapshots; orchestration belongs in `api/src/services/runner.ts` and `api/src/services/cppAdapter.ts`, not in routes.
- **Docs:** Keep [`README.md`](README.md) aligned with the command contract and keep [`TESTING.md`](TESTING.md) aligned with test-layer conventions.

## CI

- [`.github/workflows/ci.yml`](.github/workflows/ci.yml) — Node (lint, typecheck, build, Vitest coverage for web and api), C++ engine build + engine smoke, and Playwright smoke/full jobs.

## Security / scope

Intended for **local/trusted** use. CORS is env-driven; `allow_credentials` + wildcard origin `*` is rejected at startup.

## Cursor Cloud specific instructions

### Environment

- **Node 22**, **pnpm 10.8.0** — use Corepack or the setup scripts to match `package.json` / CI.
- No external services (database, cache, message broker) are required — all storage is file-backed under `outputs/`.

### Running dev servers

- `pnpm dev` starts both Vite (`:5173`) and the Fastify API (`:8000`) in parallel.
- The Vite dev server may bind to **IPv6 `localhost`** by default. The Playwright config checks `127.0.0.1:5173` (IPv4), which won't match a running `pnpm dev` Vite instance. Therefore, **stop `pnpm dev` before running `pnpm test:e2e`** — Playwright starts its own servers with `--host 127.0.0.1` and manages their lifecycle.

### Running tests

- `pnpm test` and `pnpm test:api:engine` can run with or without dev servers.
- `pnpm test:e2e` / `pnpm test:e2e:full`: **ports 5173 and 8000 must be free**. Playwright starts its own servers via the `webServer` config.
- `pnpm check` does not require Python or a virtualenv.

### Hello-world smoke test

To validate the full pipeline via the API:

```bash
pnpm dev &   # or start web + api per README
curl -s -X POST http://127.0.0.1:8000/api/sims \
 -F "export=@data/export.json" \
 -F 'config={"teams":[],"seed":42,"runs":10,"n_workers":1}'
# Wait, then:
curl -s http://127.0.0.1:8000/api/sims | jq '.[0].status' # → "complete"
```
