# Testing Guide

This repository keeps testing in three layers:

- `pytest` for backend route, service, runner, and engine behavior
- `Vitest` for frontend units, stores, composables, and view state
- `Playwright` for browser integration against the current UI surface

## Commands

```bash
pnpm test              # Fast local feedback: Vitest + pytest
pnpm test:api:engine   # Real vendored-engine smoke path
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
- Backend runner tests should cover progress transitions, metadata writes, and failure behavior.
- Frontend unit tests should cover state transitions and user-visible rendering, not implementation details.
- Playwright should cover navigation and seeded UI states that exist today. Do not fake end-to-end create/download browser flows until the UI implements them.

## Test Patterns

- Follow AAA in every test: Arrange, Act, Assert.
- Keep fixtures reusable and deterministic. Seed outputs into temp directories for backend tests and into `e2e/fixtures/outputs/` for browser tests.
- Prefer one behavior per test. Split error handling into separate test cases.
- Use marks or tags for slower paths:
  - `@smoke` for Playwright PR coverage
  - `engine` marker for the real vendored-engine smoke path

## Choosing the Right Layer

- Use `pytest` route tests when the contract is HTTP-level and the browser is irrelevant.
- Use `pytest` service tests when file-backed behavior can be validated faster without HTTP.
- Use `Vitest` when the behavior is local to Vue state, composables, or rendering.
- Use `Playwright` only when the browser, routing, or live API wiring is the thing being validated.

## Coverage Defaults

- Frontend coverage is enforced through `web/vitest.config.ts` with V8 coverage thresholds of 70%.
- Backend coverage is enforced in CI through `pytest-cov` with a 70% fail-under threshold on the targeted app modules.
- Vendored engine files under `api/vendor/progbox_v41/` are excluded from coverage targets.
- Placeholder-only UI, such as `NewSimView.vue`, is excluded until it gains behavior worth testing.

## RED, GREEN, REFACTOR

Use the TDD loop for future test work:

1. RED: write the smallest failing test that captures the missing behavior.
2. GREEN: add the minimum implementation needed to make it pass.
3. REFACTOR: clean up duplication and naming while the full suite stays green.
