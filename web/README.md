# progbox-ui Web

Vue 3 SPA for the progbox Monte Carlo simulation engine.

## Stack

- Vue 3 + TypeScript
- Vite
- Vue Router + Pinia
- Tailwind CSS v4
- Vitest

## Commands

```bash
pnpm dev          # Start dev server
pnpm build        # Production build
pnpm preview      # Preview production build
pnpm test         # Run Vitest
pnpm lint         # ESLint check
pnpm typecheck    # TypeScript check
```

## Project Structure

```
src/
  components/     # Vue components
  views/          # Page-level views
  lib/            # Utilities and API client
  stores/         # Pinia stores
  router/         # Vue Router config
```

## API Client

The web app uses `ofetch` via `src/lib/api.ts`. By default, it proxies `/api` to the FastAPI backend at `http://127.0.0.1:8000`.

To override the API base URL, set `VITE_API_BASE_URL` in a `.env` file or environment.
