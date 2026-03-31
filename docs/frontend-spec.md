# Progbox Frontend - Implementation Plan

**Goal:** A Vue 3 SPA that wraps the existing Python Monte Carlo engine behind a FastAPI backend, giving 3 devs a single pane of glass to upload exports, configure + launch sims, and browse all past runs and their results.

**Architecture:** Monorepo with two packages: `api/` (FastAPI, wraps existing Python scripts unmodified) and `web/` (Vue 3 SPA). Everything runs locally. Vite dev server proxies `/api` to FastAPI on `localhost:8000`. The API manages sim lifecycle via background tasks with SSE for real-time progress. File-based storage under `outputs/` - no database.

## Tech Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Backend | FastAPI + `BackgroundTasks` | Async-native, wraps existing sync Python via `run_in_executor` |
| Realtime | SSE (Server-Sent Events) | Simpler than WebSocket for unidirectional progress. Native `EventSource` in browser |
| Frontend | Vue 3 + Composition API + Vue Router + Pinia | Requested stack |
| Styling | Tailwind CSS v4 | Default |
| Charts (interactive) | Chart.js via `vue-chartjs` | Lightweight, good Vue adapter, covers tables/hover |
| Charts (diagnostic) | Existing matplotlib PNGs served as static files | Already production-quality, no reason to rewrite |
| Tables | TanStack Table (`@tanstack/vue-table`) | Sort/filter/paginate player data, familiar API |
| HTTP | `ofetch` | Minimal, SSR-safe, good defaults |
| Build | Vite | Default for Vue |
| Package manager | pnpm | Default |

## Versioning & Run Metadata

**CalVer Build ID** — `YYYYMMDDHHmmss` (e.g. `20260327174358`). Canonical run id and output directory name. Replaces `YYYYMMDD_HHMMSS`.

**Script Version** — e.g. `v4.1`, tracked in metadata.

Example `metadata.json` fields: `build`, `script_version`, `teams`, `seed`, `runs`, `n_workers`, `export_file`, `teaminfo_file`, `status`, `started_at`, `completed_at`, `player_count`, `config_snapshot` (full `progutils.Config` state).

## Architecture Overview

```
progbox/
├── api/
├── web/
├── data/
├── outputs/
├── progutils.py          # UNTOUCHED when vendored
├── runsim.py             # UNTOUCHED
├── analysis.py           # UNTOUCHED
├── exportcleaner.py      # UNTOUCHED
└── main.py               # CLI standalone
```

## API Surface

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/sims` | Upload export + config, start sim |
| GET | `/api/sims` | List runs |
| GET | `/api/sims/:build` | Single run metadata |
| GET | `/api/sims/:build/progress` | SSE progress |
| GET | `/api/sims/:build/charts` | List chart filenames |
| GET | `/api/sims/:build/charts/:name` | PNG |
| GET | `/api/sims/:build/players` | Player table |
| GET | `/api/sims/:build/players/:pid` | Single player |
| GET | `/api/sims/:build/godprogs` | God prog events |
| GET | `/api/sims/:build/download` | analysis.xlsx |
| GET | `/api/config` | Config constants |
| DELETE | `/api/sims/:build` | Delete run folder |

## Task Breakdown (blocks)

1. **API skeleton** — storage scan, metadata, read-only routes, `GET /api/config` stub wired to `progutils` when engine is present.
2. **Vue shell + dashboard** — router, Pinia, proxy, dashboard list.
3. **Run detail** — tabs, charts, players, god progs, export.
4. **Runner** — POST sim, executor, SSE phases, metadata updates.
5. **New sim view** — upload, config, progress, redirect.
6. **Polish** — delete run, errors, empty states, skeletons, filters.

---

_Saved for local reference; implementation evolves in this repository._
