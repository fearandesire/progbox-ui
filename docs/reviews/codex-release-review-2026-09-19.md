# Initial independent release review

[Visual verdict](net-release-verdict.html) | [Implementation plan](../superpowers/plans/2026-09-19-net-release-fixes.md)

> Historical snapshot of the original PR heads. The user subsequently asked Codex to implement the fixes. See [the completed verification](release-verification-2026-09-19.md) for the current verdict.

**Initial verdict: hold both PRs as originally framed.** The existing automated checks pass for progbox-ui, but the review reproduced comparison presentation defects and model parity gaps that invalidate treating the C++ scorecard as live NET release acceptance.

The user's latest direction is **review here, Cursor ships**. No source fixes, commits, pushes, merges, tags, npm publishes, or deployments were performed. The review goal is complete when this evidence and required dispositions are handed back. Keep progbox Published on `v3.2.1`; no baseline flip is authorized by this review.

## Reviewed revisions

| Repository / change | Base | Reviewed head |
|---|---|---|
| [progbox-ui #36 — Published/Candidate/Legacy catalog and comparison](https://github.com/fearandesire/progbox-ui/pull/36) | `0140743ab3d058ea52da3cb0dedb83008765a35e` | `2f581a6f30bb9063a4a408daa6b2f4759488c758` |
| [NoEyeTest #7 — NET 4.3.0 candidate progression port](https://github.com/fearandesire/NoEyeTest/pull/7) | `972f9d3c08476bd91276ea7327b0972dfba3a382` | `ff84ef7fee24d204e6543cfbb2d563557f87193a` |

Both were open drafts with matching heads at review. GitHub checks: progbox web/API/e2e-smoke/GitGuardian passed; NET only GitGuardian passed. That NET check is not behavioral validation.

Worktrees: `/home/fenix/code/worktrees/progbox-ui-net-release-review` and `/home/fenix/code/worktrees/noeyetest-net-release-review`. Canonical checkouts were preserved.

## Standards review

**P2 — navigation can display the previous pair's results.** `web/src/views/CompareView.vue:147-149` waits for `fetchSims()` before `load()` invalidates the previous request. Start A/B, navigate C/D while its metadata request is pending, then resolve A/B: the old data is accepted beneath C/D labels. A deferred-promise probe executes the actual extracted functions. Invalidate/reset at bootstrap entry and guard metadata and comparison with the same generation token. Add a regression covering slow metadata and out-of-order results.

**Release assurance gap — NET has no executable behavioral suite.** `package.json:8` unconditionally fails `pnpm test`; no product CI/test files exist. A numerical rewrite that mutates league ratings needs real helper semantics in deterministic tests, plus a BBGM lifecycle fixture. Required cases: normal/god progression, floor/clamp/ceiling boundaries, negative/zero PER, population membership, old/traded/playoff rows, untouched under-25/unwatched players, and ratings-history rebuilding.

No new actionable security vulnerability was established within the stated local/trusted scope. The mirrored web/API catalogs are a low-priority duplication risk, not grounds for a broad redesign.

**Standards outcome:** one reproduced correctness finding and one release-assurance gap; worst reproduced issue P2.

## Spec review

### P1 — candidate JS output distribution differs from the model being validated

`NoEyeTest/src/NoEyeTest.js:577` calls `bbgm.player.limitRating(before + d)` on continuous deltas. Current [upstream BBGM helper](https://raw.githubusercontent.com/zengm-games/zengm/master/src/worker/core/player/limitRating.ts) floors ratings; C++ `v43_progression.hpp` clamps but retains fractions. For an age-30 player with all attributes 50 and zero noise, actual compiled C++ produces speed 49.22, strength 49.82, shooting 50.21; JS produces 49, 49, 50. Full arrays and probes are in the parity appendix.

This is a proven parity difference, not an instruction to bypass BBGM's integer convention. Agree a rounding contract, enforce it in the simulator and runtime, then regenerate the scorecard. Current upstream helper behavior was verified; a specific live league's deployed BBGM revision was not.

### P1 release-evidence blocker — Published C++ is not exact live NET 3.2

This engine behavior **predates these PRs**, but #36 newly labels it “what leagues run today.” At age>=30 with a positive physical progression maximum <=3, old NET JS generally proceeds and only skips on its rare 1–6% branch; C++ `v321_progression.hpp:252-255` skips on the opposite branch, about 96.5% on average. A deterministic random=.5 example gives JS proceeds / C++ skips. Old JS god bonus is 7–12; C++ is 7–13 inclusive. Stats aggregation also differs.

Evidence: pinned old JS snapshot in `net-published-main.js:299-313` and `:260-265`; C++ source and probe in the appendix. Treat `v321` as matching lineage, not verified literal live behavior. Either establish literal baseline parity and regenerate evidence, or qualify the public comparison as a research approximation. Keep the Published ID unchanged while resolving this.

### P2 — population and lifecycle parity remain unresolved

`NoEyeTest.js:208-210,593-605` rejects negative PER during pool preparation, while C++ admits PER !=0. JS also lacks the loader's `tid>=-1` and nonempty-ratings predicates. A +15/-5 equal-reliability fixture yields C++ pool mean 5 versus JS 15. Actual availability of retired players in the live cache was not tested.

I4 is primarily **stale-season selection**, not ordinary trade rows: normal same-season last-stint rows match C++. The sample C++ pool contains 359 players, including 131 whose selected stats predate 2017; JS same-age-year/current-season selection yields 228. NET runs after season increment using prior-season stats and rebuilt prior ratings; the sample is phase 1 and uses export-season ages/latest ratings. WorkerConsole flags 25+ before season increment, so its normal users are at least 26 when NET runs. The scorecard's age-25 result is not an entering-age-25 live acceptance result.

Define season, age, row aggregation, membership and base-ratings contracts before making changes. Do not blindly remove JS season filtering; it reflects existing league behavior.

### P2 — Published-first UI does not ensure Published-first cached results

`web/src/views/CompareView.vue:63-75,93-99` promises Published on the left. The API at `api/src/routes/sims.ts:638-644` keys cache by sorted IDs but generates in first-request order; `:682` returns sorted IDs regardless of embedded plot order.

**Live reproduction:** create Candidate `20260919014301`, Published `20260919014302`; request compare-data with Candidate first, then Published first. Both responses report scorecard scripts `[v4.3, v3.2.1]`. Chromium shows Published-first chips and “Left: NET 3.2” above a Candidate-first table. Screenshot and both actual API payloads are in the evidence directory. The cache implementation is pre-existing; the new Published-first guarantee fails against it.

Fix the order/cache contract across HTML and JSON and invalidate incompatible caches. Test reverse-order priming and concurrent requests, rather than merely asserting the order passed to a mocked fetch.

### P2 compatibility — old metadata loses role framing

`web/src/lib/versions.ts:21-22` only recognizes dotted IDs. Existing `requested_version: v43/v41/v321` therefore returns null, despite VersionChip accepting those historical aliases. Run Detail falls back to raw compact text; Compare loses Published-first classification and role labels. This affects the handoff's own pre-dotted pair. Normalize historical metadata for display without re-enabling compact IDs as new API request values; test compact and script-version-only historical metadata.

**Spec outcome:** five findings/evidence blockers above: two P1 and three P2. The highest risk is treating either C++ distribution as proven live-JS behavior.

## Claims ledger disposition

- **P1–P3:** new dotted requests, CLI mapping, partner selection and fresh pair role framing work. `/api/config` exposes the three correct IDs and Published pointer. Existing metadata compatibility is incomplete.
- **P4:** disagree with the unconditional Published-first artifact claim; cache inversion reproduced.
- **P5:** fresh dotted roles work; historical compact roles remain raw.
- **P6:** disagree with unconditional merge readiness until presentation defects and baseline wording/evidence are resolved.
- **P7:** configuration and formula structure agree; applied ratings and inputs do not establish behavioral parity.
- **P8–P10:** C1 age gate, I2 under-25 skip-before-mutation, and I1 unpublished framing are present. C1 does not establish complete pool parity.
- **P11–P12:** tests absent; row-selection issue remains, with the corrected characterization above.
- **P13:** latest user direction delegates shipping to Cursor. This review performs no release action.
- **P14:** catalogs currently agree; duplication remains a nonblocking risk.

Historical artifacts from the handoff were not available: the named store held only two follow-up/missing-source notes. Original PNG/XLSX/HTML claims cannot be certified. Fresh reproduction below is separate evidence.

## Fresh numerical evidence

Exact requested config: seed42, 100 runs, 3 workers, all teams, Candidate `v4.3`, compare=true. Export SHA256 `4feaaf8b156c30d5cd36644ac5d4da6d60064469f0908d7cdc55af24958d0691`. Candidate build `20260919014301`; Published `20260919014302`. Both complete, 359 players each, Python analysis, matching paired inputs. Raw outputs/workbooks/HTML are retained under `outputs/`.

Most headline engine numbers reproduce: PrimeSep 1.887→.491; drift −1.125→+.058; ICC .964→.942; median sigma 1.077→1.771; god events 587→573. These describe the C++ engines, not validated live JS.

Corrections and qualifications:

1. **N17:** 284/359 = **79.1086%** higher candidate MeanDelta; 71 lower and 4 tied. **N18's “71% lower under published” is unsupported** as the same paired comparison; 71 is the count of players lower under Candidate, not that percentage.
2. **N10:** ages25–27 strict MeanDelta increase is **136/146 = 93.1507%**, not92.5%. Keep full-precision joins and explicit definitions.
3. **N8:** Kendall tau of rounded engine summary MeanOvr is .928402; full-precision raw/workbook means give .926080. Identify precision when quoting .928.
4. **N9/N12:** age25 positive shares count player-run outcomes, not players with positive means. Age41 is exactly one player, Garnett; it cannot establish a general late-career cliff.
5. **N13/N19:** PeakAge is a cross-sectional zero crossing of expected one-step delta, not peak career OVR. High final-OVR rank correlation does not establish fairness, realism or safe rollout.

The scorecard appendix records every N1–N20 disposition, raw/workbook checks, cohort counts, and statistical limitations. Same seed does not mean identical random shocks across different engines, and 100 repetitions of one roster are not 100 independent leagues.

## Validation

| Check | Result |
|---|---|
| progbox `pnpm check` | Pass: lint, typechecks, web build |
| progbox `pnpm test` | Pass: 97 web +87 API |
| `pnpm build:engine` | Pass |
| `pnpm test:api:engine` with Python dependencies | Pass: 5/5, real binary present |
| `CI=1 pnpm test:e2e:full` | Pass: 10/10; initial missing Chromium environment repaired before rerun |
| NET `pnpm exec biome check .` | Pass, no auto-fixes |
| NET `pnpm test` | Fails by design: missing test suite |
| Fresh 100-run pair + HTML/JSON + Chromium inspection | Complete; cache defect reproduced |
| BBGM live league execution | Not performed |

Node22.23.1, pnpm10.8.0; pinned Python requirements installed in the isolated worktree venv. Build warnings were advisory. Review probes demonstrate failures even though the existing tests pass.

## Cursor completion gates

1. Fix comparison cache ordering, navigation races, and historical role normalization; add targeted regression tests and rerun progbox validation.
2. Set explicit runtime/simulator contracts for rounding, eligibility, season transition and base ratings. Resolve baseline drift or qualify “Published” claims; add executable NET behavioral tests using actual BBGM helper semantics.
3. Regenerate acceptance evidence against those contracts; correct numeric copy, retain reproducible sources, and verify an actual BBGM before/after lifecycle on a disposable league copy.
4. Refresh both PR heads and hosted checks, update review/release descriptions around final behavior, and record exact merge/tag/publication receipts when Cursor ships. No release readiness claim is granted by this report. Keep Published at `v3.2.1` until a separate deliberate change.

## Evidence pack

Within this worktree, `outputs/release-review/` contains detailed `net-parity-review.md`, `net-scorecard-review.md`, `net-standards-review.md`, runnable probes, logs, manifest, actual compare payloads and the cache-order screenshot. The portable archive includes this report, evidence, and both fresh raw runs/analysis outputs. No historical-artifact verification or live gameplay acceptance is implied.
