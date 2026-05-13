# progbox-ui Web

Vue 3 frontend for Progbox Monte Carlo simulations. The simulation engine is the vendored **C++** binary under `api/vendor/progbox_cpp/`; the HTTP API is **TypeScript (Fastify)** in `api/src/`.

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

The web app proxies `/api` to the Node API (`http://127.0.0.1:8000` in dev). Set `VITE_API_BASE_URL` to override.
