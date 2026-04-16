# progbox-ui

Simple UI + API for running Progbox simulations.

*Progbox* — the Monte Carlo simulation engine — is already implemented and vendored in this repo, so this project makes running it much easier.

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

The API runner (`api/services/runner.py`) orchestrates the vendored engine by:
1. Running `exportcleaner.py` to validate and clean the uploaded export file
2. Calling `runsim.PROGEMUP()` to execute the Monte Carlo simulation
3. Using `analysis.generate_analysis()` to produce charts and Excel reports

All engine functions are imported through `api/services/engine_adapter.py` for clean separation.

### Updating the Engine

You can update to a newer version of the Progbox engine **as long as the APIs remain compatible**:

1. **Replace the vendored code**: Copy the updated engine files into `api/vendor/progbox_v41/`
2. **Verify the interface**: The engine must still expose:
   - `exportcleaner.exportcleaner(export_file, teams, teaminfo_file)` - validates and cleans export files
   - `runsim_cls(seed=seed).PROGEMUP(data, runs, output_dir, n_workers)` - runs simulations (PROGEMUP is an instance method)
   - `analysis.generate_analysis(output_dir)` - generates charts and analysis files
   - `progutils.Config` - configuration object
3. **Ensure output compatibility**: The engine must write outputs to the same paths:
   - `raw/*.csv` - raw simulation data
   - `charts/*.png` - visualization charts
   - `analysis.xlsx` - final analysis spreadsheet
   - `raw/godprogs.json` - god progression data (written by the engine into the `raw/` subdirectory)

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
