# progbox-ui

Vue 3 + FastAPI UI for the [progbox](https://github.com/akshayexists/progbox) Monte Carlo engine (e.g. branch `dev-v4.1`). This repo is the **frontend + API wrapper**; the simulation engine code normally lives in **progbox**, not here, unless you add it.

---

## Install and setup

### Prerequisites

- **Node.js** 22+ and **pnpm** 10+ (see [`.prototools`](.prototools); `corepack enable` is optional).
- **Python** 3.11+ recommended (CI uses 3.12). Use a virtual environment for the API.

### Steps

```bash
# 1) JavaScript (monorepo root)
pnpm install

# 2) Python API
python -m venv .venv
# Windows: .venv\Scripts\activate
# Unix:    source .venv/bin/activate
pip install -r api/requirements.txt
```

### Run locally

From the **repository root**:

```bash
pnpm dev
```

- **Web:** [http://localhost:5173](http://localhost:5173) — Vite dev server; proxies `/api` to the API.
- **API:** [http://127.0.0.1:8000](http://127.0.0.1:8000) — OpenAPI docs at `/docs`.

Other useful commands: `pnpm verify` (lint, typecheck, build, tests), `pnpm test`, `pnpm doctor` (lightweight JS checks only).

---

## Repository guide

### Package layout

| Location | What it is |
| --- | --- |
| [`web/`](web/) | Vue 3 SPA (Vite, Vue Router, Pinia, Tailwind v4). Main UI: dashboard, new sim, run detail. |
| [`api/`](api/) | FastAPI application. Entry: [`api/main.py`](api/main.py). Routes under `api/routes/`. |
| [`outputs/`](outputs/) | **Run storage** (no database). Created at runtime; only [`outputs/.gitkeep`](outputs/.gitkeep) is tracked. |
| [`docs/`](docs/) | [Product plan](docs/IMPLEMENTATION_PLAN.md) and [optional DX follow-ups](docs/PHASE2.md). |

### How runs and `outputs/` work

- Each simulation run is identified by a **CalVer build id**: `YYYYMMDDHHmmss` (14 digits, no separators), e.g. `20260327174358`.
- The API expects each run under **`outputs/<build_id>/`**, with at least **`metadata.json`** describing the run (see the plan in `docs/IMPLEMENTATION_PLAN.md` for the full schema).
- The dashboard and run detail views read from the API, which scans `outputs/` via [`api/services/storage.py`](api/services/storage.py).
- To point storage somewhere else (e.g. a shared drive), set **`PROGBOX_OUTPUTS_DIR`** to an absolute path (see below).

### Configuration (environment variables)

| Variable | When to use |
| --- | --- |
| `PROGBOX_OUTPUTS_DIR` | Override the directory used instead of `<repo>/outputs/`. Must be readable/writable by the API process. |
| `VITE_API_BASE_URL` | Override the API base URL for the web app (default **`/api`** behind the Vite proxy). Use an absolute URL if the SPA is not served by Vite (e.g. static hosting + separate API host). |
| `CORS_ALLOW_ORIGINS` | Comma-separated browser origins allowed by the API (defaults include `http://localhost:5173` and `http://127.0.0.1:5173`). |
| `CORS_ALLOW_CREDENTIALS` | `true` or `false` (default `true`). Cannot use `true` together with origin `*`. |

### What is required before **simulations** actually run

This UI is built to orchestrate the upstream **progbox** pipeline (`exportcleaner` → `runsim` → `analysis`). Today:

1. **`api/services/runner.py` is not implemented** — starting a new sim via `POST /api/sims` returns **501** until Block 4 is built.
2. **Engine code is not in this repository by default** — clone or link [progbox](https://github.com/akshayexists/progbox) (e.g. `dev-v4.1`) and ensure the API process can **import** those modules (e.g. `PYTHONPATH`, editable install, or vendoring into a package path you control).
3. **Input files** — the plan expects `export.json` (and related files such as `teaminfo.json` under a `data/` layout as in progbox). The exact paths will be defined by the runner when implemented; until then, placing compatible `outputs/` trees is enough to exercise **read-only** UI and API routes.

4. **`GET /api/config`** — stub until it reads real `progutils.Config` from the engine package.

Until the runner lands, you can still develop the UI against **manually created** `outputs/<build>/metadata.json` fixtures.

### Agent / automation notes

- See [`AGENTS.md`](AGENTS.md) for contributor and automation-oriented conventions.

### Further reading

- [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) — full product and API surface.
- [docs/PHASE2.md](docs/PHASE2.md) — optional platform tooling (Odysseus org, Vite+, etc.).

### Odysseus platform (optional)

This repo can adopt shared conventions from `odysseustech` later; see `docs/PHASE2.md`.
