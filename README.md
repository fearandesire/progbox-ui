# progbox-ui

Vue 3 + FastAPI UI for the [progbox](https://github.com/akshayexists/progbox) Monte Carlo simulation engine.

This repo contains the **frontend and API wrapper**. The simulation engine itself lives in the [progbox](https://github.com/akshayexists/progbox) repository.

## Quick Start

**Prerequisites:** Node.js 22+, pnpm 10+, Python 3.11+

```bash
# Install JS dependencies
pnpm install

# Install Python dependencies
python -m venv .venv
# Windows: .venv\Scripts\activate
# Unix: source .venv/bin/activate
pip install -r api/requirements.txt

# Start both web and API
pnpm dev
```

- **Web:** http://localhost:5173
- **API:** http://127.0.0.1:8000/docs

## Common Commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | Run web + API in parallel |
| `pnpm verify` | Lint, typecheck, build, and test |
| `pnpm test` | Run all tests |
| `pnpm doctor` | Check environment health |

## Project Structure

```
web/        # Vue 3 SPA (Vite, Tailwind v4)
api/        # FastAPI application
outputs/    # Simulation run storage (gitignored)
docs/       # Product plan and implementation notes
```

## Configuration

| Variable | Purpose |
|----------|---------|
| `PROGBOX_OUTPUTS_DIR` | Custom path for simulation outputs |
| `VITE_API_BASE_URL` | Override API base URL |

## Documentation

- [AGENTS.md](AGENTS.md) — Developer and automation guide
- [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) — Full product spec
- [docs/PHASE2.md](docs/PHASE2.md) — Future enhancements

## Note on Simulations

The simulation runner is not yet implemented. The UI currently works with manually created `outputs/<build>/metadata.json` fixtures. See [AGENTS.md](AGENTS.md) for integration details.
