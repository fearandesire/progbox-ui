# NET release fixes implementation plan

> For agentic workers: use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task by task. Checkboxes track completion. Codex resumed implementation and shipping at the user’s request.

Goal: Make the comparisons trustworthy and establish whether NET 4.3.0 matches the simulator before release.

Architecture: Fix comparison presentation independently from progression math. Preserve BBGM behavior while making the simulator's rounding, inputs and Published baseline explicit. Validate both with regression tests and fresh run evidence.

Tech stack: Vue 3, Fastify, Vitest, Playwright, JavaScript, C++20, Python analysis.

## Starting point

Read [the review](../../reviews/codex-release-review-2026-09-19.md) and [the visual verdict](../../reviews/net-release-verdict.html). Evidence and executable reproductions are in `outputs/release-review/` in the review worktree or the supplied archive.

| Repository | Reviewed PR / head | Local review checkout |
|---|---|---|
| progbox-ui | #36 / `2f581a6` | `/home/fenix/code/worktrees/progbox-ui-net-release-review` |
| NoEyeTest | #7 / `ff84ef7` | `/home/fenix/code/worktrees/noeyetest-net-release-review` |

Paths below are relative to the named repository. Refresh PR heads and diff any later changes before editing. Preserve dirty work. Use the host's `git task` workflow for a new checkout; do not edit canonical checkouts or create repository-local worktrees.

Keep Candidate `v4.3` as the default and Published `v3.2.1` as the comparison partner. Preserve dotted public IDs and compact CLI mappings. Do not change the Published pointer in this work. Old run files remain historical evidence.

The plan has two independent parts: tasks 1-3 repair progbox presentation; tasks 4-6 establish NET and engine parity. Tasks 7-8 validate the combined result. Implementation and verification are complete; the [verification report](../../reviews/release-verification-2026-09-19.md) records the evidence. The final merge/tag action remains separately observable on GitHub.

## 1. Make comparison order part of the cache contract

Files, progbox-ui: `api/src/routes/sims.ts`, `api/src/services/analysisPython.ts` if needed for synchronization, `api/src/sims.routes.test.ts`, `api/src/analysisData.routes.test.ts`.

- [x] Add a failing route regression. Generate Candidate-first HTML/JSON, request the reverse order, and inspect script columns, chart traces and response `builds`. Also cover concurrent requests for both orders and comparisons of three or more runs: A/B/C versus A/B/D must have separate caches; C/B/A must preserve its own order.
- [x] Run `pnpm --filter @progbox/api exec vitest run src/sims.routes.test.ts src/analysisData.routes.test.ts`; confirm the new ordering assertion fails on the reviewed head.
- [x] Respect validated request order end to end. Use a new order-sensitive cache namespace, derive it from every validated ID, for example `order-v2_${builds.join("_")}`. Return `{key, builds}` from the shared comparison resolver. Pass `builds` to generation and return it in JSON; do not reconstruct IDs by splitting the cache key. Existing sorted-key artifacts stay untouched and are not reused by the new contract.
- [x] Keep the current generation lock. Test that repeated identical requests reuse the same cache and that a completed cache includes HTML and scorecard data before consumers read it.
- [x] Rerun the targeted tests. Compare real generated HTML and JSON in both orders. Commit as `fix(api): preserve comparison order in cached artifacts`, with a body naming the cache namespace, response metadata and regressions.

Acceptance: priming the opposite order cannot change the scripts shown under Published-first chips. HTML, JSON, chart legends and columns agree.

## 2. Reject stale results as soon as navigation starts

Files, progbox-ui: `web/src/views/CompareView.vue`, `web/src/views/CompareView.test.ts`.

- [x] Add a deferred-promise test: begin A/B comparison, navigate to C/D, hold C/D metadata pending, then resolve A/B. Assert that A/B data never appears under C/D labels. Cover stale metadata failure, invalid queries and unmount too.
- [x] Run `pnpm --filter web exec vitest run src/views/CompareView.test.ts`; expect the new race test to fail.
- [x] Start one generation token at `bootstrap()` entry, snapshot the requested builds, and clear prior data/error/metadata immediately. Guard every asynchronous write with that token, including `finally`. Invalidate on unmount. Remove the later token increment inside `load()` so both stages belong to the same request.
- [x] Preserve iframe fallback for a current comparison failure, loading feedback during metadata fetch, and the short-query prompt. Rerun tests and commit as `fix(web): discard stale comparison requests`.

Control flow to implement:

```ts
const token = ++requestId;
const requestedBuilds = [...builds.value];
data.value = null;
loadError.value = null;
runs.value = [];
loading.value = requestedBuilds.length >= 2;
// Fetch metadata, verify token, derive order from this snapshot.
// Fetch comparison, verify token, publish result.
// Only this token may clear loading or select the fallback.
```

Acceptance: no earlier request can publish data, metadata, errors or loading state into the current comparison.

## 3. Normalize historical versions at the display boundary

Files, progbox-ui: `web/src/lib/versions.ts`; create `web/src/lib/versions.test.ts`; update `VersionChip.vue`, `DashboardView.vue`, `RunDetailView.vue`, `CompareView.vue` and their existing tests.

- [x] Add tests mapping `v321`, `v41`, `v43` to their dotted IDs and roles. Include known engine names, missing `requested_version` with a valid `script_version`, and unknown inputs such as `v4.30` or `foo321` that must stay unknown.
- [x] Implement one display resolver. Resolve the first recognized version from `requested_version`, then `script_version`, using exact aliases or anchored known engine-name prefixes. Reuse it in chips and role consumers. Avoid loose substring guesses.
- [x] Test a historical compact-ID pair, Published selected as primary, Published/Legacy, and an unknown-version run. Keep API creation validation dotted-only.
- [x] Run the affected web tests and `pnpm --filter @progbox/api exec vitest run src/progressionVersions.test.ts src/sims.routes.test.ts`. Commit as `fix(web): restore roles for historical simulation runs`.

Acceptance: old runs receive the same labels and ordering as equivalent new runs; unknown versions are never mislabeled Published.

## 4. Write the runtime and simulator contract before changing math

Create in progbox-ui: `docs/net-parity-contract.md`. Update `README.md` and `docs/benchmarks/v321-v43-release-validation.md` as the decisions become settled. In NoEyeTest, update `README.md` and `tiers.md` to state the same rules.

- [x] Pin the BBGM helper revision and the live NET reference commit. The review used NET `972f9d3`; current upstream BBGM source was inspected, but no deployed BBGM revision was verified.
- [x] Record the decisions below with rationale and test fixtures. Mark any unresolved choice explicitly; do not call the candidate release-ready while a choice remains open.
- [x] Record which differences were pre-existing and which came from the port. Commit the contract as `docs: define NET runtime and simulator parity`.

| Decision | Recommended starting choice | Required proof |
|---|---|---|
| Candidate ratings | Preserve BBGM integer/floor semantics; model those in C++ before computing OVR. | Age30, all attributes50, zero-noise probe agrees attribute by attribute. |
| Published reference | Treat live JS3.2 behavior as the reference for a literal Published comparison. Fix the C++ approximation, not the live script. | Physical-rating branch and god bonus distribution match the pinned reference. |
| Input season and age | Use a documented before/after-preseason fixture: prior-season stats, entering-season age, prior ratings as the NET base. | The same player enters both implementations with identical inputs. |
| Pool membership | Separate preparation from progression eligibility; specify active/free-agent status, valid ratings, age and negative/zero PER behavior. | Both implementations select the same player IDs and weighted moments. |
| Traded/stale rows | Preserve JS season filtering. Specify Candidate last regular-season stint and Published's current averaging behavior separately. | Multi-team, playoffs and stale-only fixtures match each version's contract. |

If literal Published parity is intentionally deferred, rename/qualify the displayed result as an approximation and remove claims that it measures live behavior. This can unblock research UI work, but it does not close NET's live acceptance gate. Do not adopt stale rows in JS just to match the old sample count.

## 5. Add NET behavioral tests, then fix confirmed input differences

Files, NoEyeTest: `package.json`, `src/NoEyeTest.js`; create `tests/noeyetest.test.cjs`, `tests/helpers/run-script.cjs`, `tests/fixtures/` and `.github/workflows/test.yml`.

- [x] Replace the failing placeholder test command with `node --test tests/*.test.cjs`. Build a small VM test adapter that executes the script with mocked BBGM storage, pinned helper behavior and controlled randomness. Await its completion and capture written players. Keep the pasted browser script usable.
- [x] Add failing cases for every agreed pool predicate and input rule from task 4. Assert selected IDs, moments and resulting attributes, not merely calls to mocked functions.
- [x] Cover normal and god progression, inclusive/exclusive bonus boundaries per version, ceiling/clamp/floor behavior, low minutes, negative/zero PER, regular/playoff/traded/stale rows, and prior-season ratings restoration. Under-25 and unwatched players must retain their full ratings histories.
- [x] Implement only the agreed differences in `statsFor()` and `compileProgs()`. Separate pool selection from mutation eligibility. Ensure every skip that preserves BBGM progression happens before `ratings.pop()`.
- [x] Run `pnpm test` and `pnpm exec biome check .`. Add both read-only checks to CI. Commit as `test(net): cover progression and ratings preservation`, then `fix(net): align inputs with the parity contract` where fixes are needed.

Acceptance: tests exercise full script execution, fail against the demonstrated defects, and use BBGM's real rounding semantics. A clamp-only mock cannot certify parity.

## 6. Align the engine and add deterministic cross-language cases

Files, progbox-ui: `api/vendor/progbox_cpp/scripts/v43_progression.hpp`, `v321_progression.hpp`, `api/vendor/progbox_cpp/src/main.cpp`, `api/src/services/exportCleaner.ts`, `cppAdapter.ts` where input shaping requires it; create `api/vendor/progbox_cpp/tests/net_parity.cpp`; update `CMakeLists.txt`, API engine smoke tests and `.github/workflows/ci.yml`.

- [x] Add a CTest target using the actual progression headers. Start with the review's zero-noise age30 probe; test negative and positive fractional changes near limits and verify final OVR after quantization.
- [x] Add Published-reference cases for the reversed older-player physical branch and the 7-12 god bonus range. Use injected deterministic draws or a narrow test seam for stochastic branches; keep production defaults unchanged. Do not compare arbitrary JS/C++ seeded sequences as though their RNGs were identical.
- [x] Apply the task-4 contract to candidate rounding, Published rules and inputs. Keep TypeScript export cleaning and C++ loading consistent. Document the vendored patch and record an engine/source revision in new run metadata so historical results cannot be mistaken for regenerated results.
- [x] Share small JSON fixtures with NET's tests. Compare eligibility, moments, attribute arrays and derived OVR under controlled draws. Preserve declared floating-point tolerances for intermediate calculations; final integer ratings must agree exactly.
- [x] Run `pnpm build:engine`, `ctest --test-dir api/vendor/progbox_cpp/build --output-on-failure`, and `pnpm test:api:engine`. Ensure the CI engine job executes CTest. Commit as `fix(engine): match the documented NET runtime rules`, with every changed formula/input rule listed in the body.

Acceptance: deterministic runtime/engine results agree for both Published and Candidate. Old sample totals are not golden expectations if corrected eligibility changes them.

## 7. Regenerate the evidence and correct the release story

Files, progbox-ui: `docs/benchmarks/v321-v43-release-validation.md`, `README.md`, `TESTING.md`, and any public copy affected by task 4. Files, NoEyeTest: `README.md`, `CHANGELOG.md`, `tiers.md`.

- [x] Run the exact old config again under the corrected contract: seed42, runs100, workers3, all teams, dotted IDs. Preserve the old outputs and give new runs new IDs.
- [x] Repeat on a fixture with a real preseason transition. Use at least two more seeds and one additional league export or clearly labeled synthetic cohort to check whether headline conclusions depend on this roster. Report cohort sizes and per-run uncertainty; do not count repeated draws as independent leagues.
- [x] Recount from full-precision raw data joined by player ID. Verify workbook and chart values. Export a manifest with source revisions, helper version, input hash, config, build IDs and analysis version.
- [x] Replace the old narrative with results from the corrected implementation. For the existing review run only, the verified counts were 284/359 higher, 71 lower, 4 tied; ages25-27 were 136/146 higher. Its exact-mean Kendall tau was .926080. Do not reuse those values as expected outputs after changing the model.
- [x] Explain sparse cohorts, including the single age41 player, and label PeakAge as a one-step delta zero crossing. Save the fresh screenshots and evidence archive. Commit documentation as `docs: replace release claims with verified NET comparisons`.

Acceptance: every published number has a source, denominator and matching implementation revision. Missing historical screenshots are not presented as verified.

## 8. Validate and hand off the release

- [x] In progbox, install the declared Python requirements, build the engine and run CTest plus `pnpm verify:full`. Confirm real engine tests execute rather than skip; ports5173/8000 must be free for Playwright. Add browser coverage for the repaired Published-first comparison.
- [x] In NET, run behavioral tests and read-only lint. On a disposable league copy, execute WorkerConsole before progression and NET in preseason. Compare ratings history, selected players and output against the contract. Record the exact game version and before/after export hashes.
- [x] Re-review changed code against this plan, refresh hosted checks at the final PR heads, and list any accepted limitations. Approve progbox independently only after its UI defects and baseline claims are resolved. Approve NET only after runtime parity and lifecycle acceptance pass.
- [ ] Codex performs the user-authorized release once these gates pass and records exact merge commits, tag/package publication and any deployment receipts separately. Keep the Published pointer on `v3.2.1`. A release tag alone does not prove npm publication or live gameplay acceptance.

Done means the defects are fixed, the tests cover their failure modes, and the release evidence describes the implementation that ships.
