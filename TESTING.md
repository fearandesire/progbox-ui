# Testing Guide

This repository keeps testing in three layers:

- **Vitest** in `api/` for backend routes, services, export cleaning, artifacts, and CORS/config
- **Vitest** in `web/` for frontend units, stores, composables, and view state
- **Playwright** for browser integration against the current UI surface

## Commands

```bash
pnpm test              # Vitest (web + api); excludes slow engine file
pnpm test:api:engine   # Real vendored C++ engine smoke (`api/src/engine.smoke.engine.test.ts`)
pnpm test:e2e          # Playwright smoke suite
pnpm test:e2e:full     # Full seeded browser suite
pnpm verify            # PR-ready verification
pnpm verify:full       # Main/dev verification
```

Install Chromium locally before running Playwright for the first time:

```bash
npx playwright install chromium
```

## Layer Ownership

- Backend route tests should cover request validation, status codes, and serialized responses.
- Backend service tests should cover file layout, path safety, and data shaping.
- Backend engine smoke validates end-to-end C++ invocation, `raw/outputs.csv`, and generated analysis files (skipped automatically when the binary is missing).
- Frontend unit tests should cover state transitions and user-visible rendering, not implementation details.
- Playwright should cover navigation and seeded UI states that exist today. Do not fake end-to-end create/download browser flows until the UI implements them.

## Test Patterns

- Follow AAA in every test: Arrange, Act, Assert.
- Keep fixtures reusable and deterministic. Seed outputs into temp directories for backend tests and into `e2e/fixtures/outputs/` for browser tests.
- Prefer one behavior per test. Split error handling into separate test cases.
- Use tags for slower paths:
  - `@smoke` for Playwright PR coverage
  - `engine.smoke.engine.test.ts` for the real vendored-engine smoke path (`pnpm test:api:engine`)

## Choosing the Right Layer

- Use **API Vitest** route tests when the contract is HTTP-level and the browser is irrelevant.
- Use **API Vitest** service tests when file-backed behavior can be validated faster without HTTP.
- Use **web Vitest** when the behavior is local to Vue state, composables, or rendering.
- Use **Playwright** only when the browser, routing, or live API wiring is the thing being validated.

## Coverage Defaults

- Frontend coverage is enforced through `web/vitest.config.ts` with V8 coverage thresholds (see that file).
- Backend coverage is enforced in CI through `pnpm --filter @progbox/api test:coverage` (`api/vitest.config.ts`, global thresholds **65%** on statements/branches/functions/lines for `api/src/**`).
- Vendored C++ under `api/vendor/progbox_cpp/` is not part of JS coverage.
- Placeholder-only UI, such as `NewSimView.vue`, may be excluded until it gains behavior worth testing.

## RED, GREEN, REFACTOR

Use the TDD loop for future test work:

1. RED: write the smallest failing test that captures the missing behavior.
2. GREEN: add the minimum implementation needed to make it pass.
3. REFACTOR: clean up duplication and naming while the full suite stays green.
