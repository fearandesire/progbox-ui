# progbox-ui Web

Vue 3 frontend for Progbox Monte Carlo simulations. The v4.1 engine is vendored in the repo under `api/vendor/progbox_v41/` and executed by the FastAPI app.

## Stack

Vue 3 · TypeScript · Vite · Tailwind CSS v4 · Pinia · Vitest

## Commands

```bash
pnpm dev        # Start dev server
pnpm build      # Production build
pnpm test       # Run tests
pnpm lint       # Check code
pnpm typecheck  # Check types
```

## Structure

```
src/
  components/   # UI components
  views/        # Pages
  lib/          # API client, utilities
  stores/       # Pinia stores
  router/       # Routes
```

## API

The web app proxies `/api` to the FastAPI backend. Set `VITE_API_BASE_URL` to override.
