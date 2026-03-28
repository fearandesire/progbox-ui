# progbox-ui

Vue 3 + FastAPI UI for [progbox](https://github.com/akshayexists/progbox/tree/dev-v4.1) — a Monte Carlo simulation engine.

> **Note:** This repo contains the UI and API wrapper only. The simulation engine lives in the [progbox repo (dev-v4.1 branch)](https://github.com/akshayexists/progbox/tree/dev-v4.1).

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
| `pnpm verify` | Lint, typecheck, build, test |
| `pnpm test` | Run all tests |

---

## Structure

```
web/      # Vue 3 frontend (Vite, Tailwind v4)
api/      # FastAPI backend
outputs/  # Simulation storage (runtime only)
docs/     # Product specs and plans
```

---

## Configuration

| Variable | Purpose |
|----------|---------|
| `PROGBOX_OUTPUTS_DIR` | Custom simulation output path |
| `VITE_API_BASE_URL` | Override API base URL |

---

## Documentation

- [AGENTS.md](AGENTS.md) — Developer guide
- [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) — Full product spec

## Current Status

The simulation runner is not yet implemented. The UI works with manually created output fixtures for now. See [AGENTS.md](AGENTS.md) for details.
