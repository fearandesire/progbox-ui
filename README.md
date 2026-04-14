# progbox-ui

Vue 3 + FastAPI UI for **Progbox** — a Monte Carlo simulation engine. The **v4.1** engine from [akshayexists/progbox@dev-v4.1](https://github.com/akshayexists/progbox/tree/dev-v4.1) is **vendored** under [`api/vendor/progbox_v41/`](api/vendor/progbox_v41/) and run by the API (no separate checkout required for local dev).

![Home Page](docs/screenshots/home-page.png)

*The Progbox UI home page where you upload export files and configure simulation runs*

## What Lives Here

- `web/` is the Vue 3 + Vite frontend.
- `api/` is the FastAPI backend that runs the vendored engine, stores run outputs, and serves simulation artifacts.
- `e2e/` holds Playwright browser tests and seeded fixtures.
- [`TESTING.md`](TESTING.md) defines the repo-wide test layers, commands, and conventions.

---

## Quick Start

```bash
# 1. Install dependencies
pnpm install
python -m venv .venv && source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r api/requirements.txt

# 2. Start the app
pnpm dev
```

| Service | URL |
|---------|-----|
| Web UI | http://localhost:5173 |
| API Docs | http://127.0.0.1:8000/docs |

---

## Progbox Engine Integration

This UI uses the original **Progbox v4.1** Monte Carlo simulation engine from [akshayexists/progbox](https://github.com/akshayexists/progbox). The engine code is **vendored** (copied into this repository) at `api/vendor/progbox_v41/` so you can run simulations without needing a separate clone.

### How It Works

The API (`api/main.py`) orchestrates the vendored engine by:
1. Running `exportcleaner.py` to validate and clean the uploaded export file
2. Calling `runsim.PROGEMUP()` to execute the Monte Carlo simulation
3. Using `analysis.generate_analysis()` to produce charts and Excel reports

All engine functions are imported through `api/services/engine_adapter.py` for clean separation.

### Updating the Engine

You can update to a newer version of the Progbox engine **as long as the APIs remain compatible**:

1. **Replace the vendored code**: Copy the updated engine files into `api/vendor/progbox_v41/`
2. **Verify the interface**: The engine must still expose:
   - `exportcleaner.clean_export()` - validates export files
   - `runsim.PROGEMUP(...)` - runs simulations with the same parameters
   - `analysis.generate_analysis(...)` - generates charts and analysis files
   - `progutils.Config` - configuration object
3. **Ensure output compatibility**: The engine must write outputs to the same paths:
   - `raw/*.csv` - raw simulation data
   - `charts/*.png` - visualization charts
   - `analysis.xlsx` - final analysis spreadsheet
   - `godprogs.json` - god progression data

If the engine maintains these APIs and output paths, you can drop in the updated version and the UI will continue to work. Run `pnpm verify` to validate the integration after updating.

---

## Commands

| Command | What it does |
|---------|--------------|
| `pnpm dev` | Run web + API together |
| `pnpm test` | Fast unit test path: Vitest + pytest |
| `pnpm test:api:engine` | Vendored-engine smoke test |
| `pnpm test:e2e` | Playwright smoke suite |
| `pnpm test:e2e:full` | Full seeded Playwright suite |
| `pnpm verify` | Check, unit tests, engine smoke, and Playwright smoke |
| `pnpm verify:full` | Check, unit tests, engine smoke, and full Playwright |

Playwright uses the local API and frontend dev servers. Install Chromium once before running browser tests:

```bash
npx playwright install chromium
```

---

## Structure

```
web/                         # Vue 3 frontend (Vite, Tailwind v4)
api/                         # FastAPI backend
api/vendor/progbox_v41/      # Vendored progbox v4.1 engine (progutils, runsim, analysis, exportcleaner)
data/                        # Default export.json / teaminfo.json (optional; uploads override)
outputs/                     # Simulation storage (runtime; gitignored)
e2e/                         # Playwright smoke/full tests and seeded fixtures
docs/                        # Product specs and plans
```

---

## Production Readiness

This application is **fully functional** and ready for use. All core features work as intended:

✅ **Upload & Configure** - Upload export files and customize simulation parameters (teams, seed, runs, workers)
✅ **Real-time Progress** - Server-sent events (SSE) provide live progress updates during simulation execution
✅ **Results Visualization** - View generated charts, player stats, and god progression data
✅ **Artifact Downloads** - Download analysis Excel files and raw CSV data
✅ **Comprehensive Testing** - Full test coverage with Vitest (frontend), pytest (API), and Playwright (e2e)

### Current Scope

This application is designed for **local/trusted environments**. CORS is configurable via environment variables but does not include advanced security features expected in public-facing production deployments (authentication, rate limiting, etc.).

### What Works

- All simulation features from the original Progbox engine (v4.1)
- File uploads with validation and cleaning
- Multi-worker parallel simulation execution
- Progress tracking with phase-based updates
- Chart generation and visualization
- Player statistics and god progression analysis
- Excel and CSV exports
- Full test suite coverage (unit, integration, e2e)

### Known Limitations

- No user authentication or authorization
- No rate limiting on API endpoints
- File-based storage only (no database)
- Designed for local/internal use, not public internet deployment

The application is production-ready for its intended use case: running Progbox simulations in a local or trusted network environment.

---

## Configuration

| Variable | Purpose |
|----------|---------|
| `PROGBOX_OUTPUTS_DIR` | Custom simulation output path |
| `VITE_API_BASE_URL` | Override API base URL |

---

## Documentation

- [AGENTS.md](AGENTS.md) — Developer guide and repo conventions
- [TESTING.md](TESTING.md) — Test layers, fixtures, commands, and TDD expectations
- [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) — Full product spec

## Simulation API

- `POST /api/sims` — multipart: `export` (JSON file), `config` (JSON string: `teams`, `seed`, `runs`, `n_workers`), optional `teaminfo` file. Defaults `teaminfo` to `data/teaminfo.json` if omitted.
- Pipeline: `exportcleaner` → `runsim.PROGEMUP` → `analysis.generate_analysis`, writing `outputs/{build}/` (CalVer `YYYYMMDDHHmmss`).
- `GET /api/sims/{build}/progress` — SSE JSON events `{ phase, pct, message, done }`.
- `GET /api/sims/{build}/charts`, `/players`, `/godprogs`, and `/download` expose generated artifacts once a run completes.
