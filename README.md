# progbox-ui

Vue 3 + FastAPI UI for **Progbox** — a Monte Carlo simulation engine. The **v4.1** engine from [akshayexists/progbox@dev-v4.1](https://github.com/akshayexists/progbox/tree/dev-v4.1) is **vendored** under [`api/vendor/progbox_v41/`](api/vendor/progbox_v41/) and run by the API (no separate checkout required for local dev).

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
