# progbox-ui Web

Vue 3 frontend for [progbox](https://github.com/akshayexists/progbox/tree/dev-v4.1) Monte Carlo simulations.

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
