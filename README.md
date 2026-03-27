# progbox-ui

Vue 3 + FastAPI UI for the [progbox](https://github.com/akshayexists/progbox) Monte Carlo engine (`dev-v4.1`).

## Quick start

1. **Node:** 22+ and **pnpm** 10+ (`corepack enable` optional).
2. **Python:** 3.12+ with a venv; `pip install -r api/requirements.txt`.
3. From the repo root:

```bash
pnpm install
pnpm dev
```

- Web: [http://localhost:5173](http://localhost:5173) (proxies `/api` to the API).
- API: [http://127.0.0.1:8000](http://127.0.0.1:8000) — OpenAPI docs at `/docs`.

## Scripts

| Command        | Description                                      |
| -------------- | ------------------------------------------------ |
| `pnpm dev`     | Vite + uvicorn in parallel                       |
| `pnpm check`   | ESLint, `vue-tsc`, production build, `compileall` |
| `pnpm test`    | Vitest (web) + pytest (api)                      |
| `pnpm verify`  | `pnpm check` then `pnpm test`                    |
| `pnpm doctor`  | Basic environment checks                         |

## Environment (optional)

| Variable | Purpose |
| -------- | ------- |
| `VITE_API_BASE_URL` | Absolute API base for non-proxy contexts (default: `/api`). |
| `PROGBOX_OUTPUTS_DIR` | Override path to the `outputs/` directory (default: repo `outputs/`). |
| `CORS_ALLOW_ORIGINS` | Comma-separated origins (default: `http://localhost:5173,http://127.0.0.1:5173`). |
| `CORS_ALLOW_CREDENTIALS` | `true` / `false` (default: `true`). Cannot combine `true` with origin `*`. |

## Docs

- Product plan: [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md)
- Optional follow-ups: [docs/PHASE2.md](docs/PHASE2.md)

## Odysseus platform (optional)

This repo can adopt more from `odysseustech` later (`platform-templates`, `ci-platform`, `platform-config`). See `docs/PHASE2.md`.
