# Comprehensive Test Framework for Progbox UI

## Summary
- Keep three explicit test layers: backend route/service tests in `pytest`, frontend unit/state tests in `Vitest`, and browser integration in `Playwright`.
- Exclude authentication from this phase. There is no auth surface in the repo, so auth tests would be speculative scope.
- Use a hybrid E2E strategy: browser tests cover the current UI only, while simulation creation, engine execution, and artifact generation stay covered at the API/integration layer until the UI for those flows exists.
- Preserve fast local feedback with `pnpm test`; make `pnpm verify` the standard full verification command for PR-ready work; add a fuller E2E command for `main`/`dev` CI.

## Implementation Changes
- Update root scripts so the contract is explicit:
  - `pnpm test` stays fast and runs `test:web` + `test:api`.
  - Add `test:api:engine` for the real vendored-engine smoke path.
  - Add `test:e2e` for the Playwright smoke suite.
  - Add `test:e2e:full` for the broader seeded-browser suite.
  - Change `pnpm verify` to run `check`, `test`, `test:api:engine`, and `test:e2e`.
  - Add `pnpm verify:full` to run `check`, `test`, `test:api:engine`, and `test:e2e:full`.
- Extract Vitest settings into a dedicated `vitest.config.ts` and leave `vite.config.ts` focused on app/dev-server concerns. Add shared test setup, mock helpers, and V8 coverage reporting with a 70% threshold scoped to the phase-1 target modules, excluding `api/vendor/progbox_v41` and placeholder-only UI.
- Expand backend tests with shared fixtures in `api/tests/conftest.py`:
  - temp outputs root
  - metadata/artifact builders
  - seeded run directories
  - minimal export/teaminfo payloads
  - reusable FastAPI client fixture
- Extend backend coverage to all important route and pipeline behaviors:
  - `POST /api/sims` success plus validation failures for empty export, empty teaminfo, invalid `n_workers`, and missing default teaminfo
  - `GET /api/sims/{build}/progress` for running, complete, failed, and missing runs
  - `GET /api/sims/{build}/charts`, `/charts/{name}`, `/players`, `/players/{pid}`, `/godprogs`, `/download`, and delete/list/get metadata paths, including negative cases
  - service-level tests for `storage.py` and `sim_artifacts.py`, especially traversal rejection, missing files, and typed output shapes
  - runner tests around `run_simulation_job` for progress transitions, metadata merge behavior, failure handling, and expected artifact writes
- Add one marked backend smoke test that exercises the real vendored engine through `engine_adapter` using a minimal deterministic fixture. It should assert `script_version`, final metadata state, `raw/outputs.csv`, and `analysis.xlsx`. Keep this in the repo’s normal verification path, but isolate it under its own marker/script so failures are easy to diagnose.
- Add frontend unit tests for the highest-value behavior already present:
  - `web/src/lib/api.ts`: base URL handling, endpoint paths, error propagation, and `ofetch` call options
  - stores: `sims` and `config` success/error/loading transitions
  - composables: `useSimProgress` with `EventSource` mocks for happy path, malformed payloads, done-close behavior, and connection errors; `usePlayerFilter` edge filtering
  - views/components: `DashboardView`, `RunDetailView`, and `SimProgressPanel` for loading, empty, error, not-found, running, and complete states
  - `NewSimView` stays a minimal render/navigation smoke test only, because it is still a placeholder
- Add `playwright.config.ts` using official multi-`webServer` support to start both the FastAPI server and Vite app, with `baseURL` pointed at the web app, `chromium` only, CI retries enabled, and `workers: 1` on CI for stability.
- Structure Playwright suites by intent instead of by page:
  - smoke suite: dashboard loads, seeded run appears, navigation to run detail works, seeded completed run renders, seeded not-found run shows the correct state
  - fuller seeded suite: running-progress UI, failed-run UI, and completed-run detail states backed by API-seeded fixture data
  - no browser test should pretend to cover upload/download flows until that UI exists
- Update `.github/workflows/ci.yml`:
  - keep existing `web` and `api` jobs
  - add `e2e-smoke` on pull requests and on `main`/`dev`
  - add `e2e-full` on `main`/`dev` only
  - install Playwright browsers with dependencies and upload Playwright report/artifacts when the E2E job fails
- Add `TESTING.md` as the shared developer guide. It should define layer ownership, AAA test shape, fixture rules, when to choose route vs service vs browser tests, naming conventions, seeded-data strategy, and the RED/GREEN/REFACTOR loop for future contributors.

## Test Plan
- Backend route/API scenarios:
  - create simulation success with scheduled job handoff
  - create simulation validation failures
  - list/get/delete metadata
  - progress SSE for all terminal and non-terminal states
  - charts, players, godprogs, and downloads with both found and missing artifacts
  - artifact path traversal rejection
- Backend engine scenarios:
  - mocked runner path for deterministic progress and failure assertions
  - real vendored-engine smoke run on minimal fixture data
- Frontend unit scenarios:
  - API client request construction and env handling
  - Pinia store loading/error transitions
  - `useSimProgress` EventSource lifecycle
  - `usePlayerFilter` filtering rules
  - dashboard and run-detail rendering across loading/error/not-found/running/complete states
- Playwright scenarios:
  - smoke: app boots, seeded dashboard data renders, route navigation works
  - fuller seeded browser coverage: completed, running, and failed run-detail states
- Verification commands after implementation:
  - `pnpm test:web`
  - `pnpm test:api`
  - `pnpm test:api:engine`
  - `pnpm test:e2e`
  - `pnpm verify`
  - `pnpm verify:full` on `main`/`dev`

## Assumptions and Defaults
- Auth is explicitly out of scope for this phase.
- Hybrid E2E is the chosen default: browser coverage is limited to the current UI, while create/download lifecycle validation stays in backend integration until those UI flows are implemented.
- Coverage enforcement is scoped to the modules targeted by this work, not to vendor code or untouched placeholder surfaces.
- Version-specific config should follow the official docs:
  - Vitest coverage uses the V8 provider and optional support package pattern described at https://v4.vitest.dev/guide/coverage
  - Playwright should use `webServer`, `baseURL`, CI retries, and CI worker limits as described at https://playwright.dev/docs/test-webserver, https://playwright.dev/docs/test-configuration, and https://playwright.dev/docs/ci
  - Backend coverage should use `pytest-cov` plus a coverage config file as documented at https://pytest-cov.readthedocs.io/en/stable/config.html
