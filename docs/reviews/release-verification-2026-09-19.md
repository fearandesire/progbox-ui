# NET release verification

Approved for opt-in release. The comparison defects and simulator/runtime mismatches are fixed. The corrected scorecard does not support the old "79% of players improve" story: on the sample roster, 111 of 228 players have a higher Candidate mean at seed 42, and the median difference is −0.035 OVR. Release readiness means the behavior is verified; it does not mean Candidate is better for every league.

[Visual review](release-verification.html) · [Fix plan](../superpowers/plans/2026-09-19-net-release-fixes.md) · [Input contract](../net-parity-contract.md) · [Initial review](codex-release-review-2026-09-19.md)

## Fixes and evidence

| Problem | Change | Verification |
|---|---|---|
| Comparison order changed after cache reuse | Ordered cache identity includes every build; CSV publishes before HTML, with atomic cross-filesystem fallback. | Opposite-order and multi-run regressions; real HTML, JSON, CSV and chart order checked both ways. |
| Navigation could display stale results | One request generation guards metadata, results, errors and loading through unmount and invalid queries. | Deferred-request regressions and Published-first Playwright coverage. |
| Historical versions lost their roles | Shared exact resolver handles known compact IDs and engine names. | Chip, Dashboard, Detail and Compare tests; unknown inputs remain unknown. |
| Candidate kept fractional ratings | C++ floors/clamps attributes before OVR, matching BBGM. | Shared controlled-draw fixtures and actual BBGM output. |
| Published differed from its reference | Corrected physical chance, shared range mutation, zero-max fallback, capped-player draw, 7–12 god bonus and negative PER behavior. | Pinned Published script replay; 137 shared cases across both versions. |
| Inputs differed by season, team and history | Explicit prior-season selection, preserved league pool, target-only team filters, preseason history guard and stable source IDs. | Ten input regressions, real loader checks and actual preseason/export evidence. |
| Float storage changed eligibility | Normalized stats use doubles; legacy rounding remains intact. | Real loader reproduced 20 → 19.999999523 attempts before the fix, then preserved 20 exactly. |
| Large seeds were rounded | God seeds serialize as decimal strings; API/UI preserve them. | Producer, route and rendered UI tests above 2^53. |
| Old binaries could claim new semantics | Engine must acknowledge the full contract and match season, count and script. Hash captured before launch. | Nine adapter regressions, including missing/wrong metadata and executable replacement. |

The release source is progbox `5639c38` and NET `2e8f6a4`; subsequent report-only commits do not change the executable behavior. The executed engine SHA-256 is `00f7fade9b0ee2566b030ea83e65b6dcd16ffad3495f41b561f5a1f5aaae99c0`.

## Checks

- `pnpm verify:full`: check/build, 122 web + 110 API tests, 5 actual engine tests, 11 Playwright tests, all passed.
- CTest: 137 math cases plus a production loader/seed target, both targets passed.
- NET: 148 full-script tests and read-only Biome passed.
- Every final workbook's player means, standard deviations and age means matched raw output within 0.000051.
- Hosted checks and exact merge/tag state are recorded on [progbox #36](https://github.com/fearandesire/progbox-ui/pull/36) and [NET #7](https://github.com/fearandesire/NoEyeTest/pull/7). Local checks are not a deployment receipt.

## Corrected comparison

Each row uses 100 stochastic runs of one fixed roster. Higher/lower/tied counts and median differences use shared source player IDs. Repeated seeds are not independent leagues.

| Roster | Seed | Shared players | Higher / lower / tied | Median Candidate − Published | Mean drift Candidate / Published |
|---|---:|---:|---:|---:|---:|
| Sample | 42 | 228 | 111 / 117 / 0 | −0.035 | −0.860 / −0.942 |
| Sample | 7 | 228 | 107 / 120 / 1 | −0.060 | −0.855 / −0.923 |
| Sample | 99 | 228 | 112 / 115 / 1 | −0.020 | −0.833 / −0.937 |
| Synthetic age/skill/production grid | 42 | 60 | 42 / 18 / 0 | +0.630 | −2.234 / −2.840 |
| Disposable BBGM fixtures | 42 | 3 | 1 / 2 / 0 | −1.160 | −0.957 / −2.485* |

*The disposable fixture has three Candidate targets and four Published targets. Its negative-PER player belongs only to Published, so the full-roster drift denominators differ. Do not read that row as a like-for-like league-wide improvement.*

The sample's ranking agreement remains high: Kendall τ of mean OVR is 0.9327–0.9361 across the three seeds. The earlier 359-player result used stale rows and a different age boundary. Its percentages are withdrawn as release evidence.

Ages 36, 37, 38, 40 and 41 have fewer than five sample players each. Age 41 has one. The analysis "PeakAge" is a cross-sectional zero crossing of one-step expected OVR change, not an estimated career peak. The synthetic grid tests model shape; the three-player disposable fixture tests integration. Neither establishes league-wide balance.

[Recount and uncertainty](evidence/corrected-evidence.md) · [Hashes and full results](evidence/corrected-evidence.json) · [Player deltas](evidence/corrected-player-deltas.csv)

## Actual BBGM acceptance

A fresh disposable league on BBGM v2026.09.16.0733 ran WorkerConsole before an actual 2019→2020 preseason transition, then NET using controlled random draws with real game helpers and storage. Two expected players changed; 748 other player records stayed identical. Ratings survived reload and full UI export. Supplemental valid free-agent and watched-retired tests passed.

A deliberately malformed empty-ratings player caused BBGM's global value recalculation to fail. That invalid-league experiment is retained and excluded from the passing result. The valid one-row history guard passed. The final NET file differs from the exercised file only in two introductory comment lines; restoring them reproduces the exact tested hash.

Before export SHA-256: `456bc08527dafcec07428af3c301eb7aec1d703db322d70f0d2f985227b5efd2`.
After export SHA-256: `c7e3b3c0d706d0f784c8e8da50e11ed52165f0755d914966ce3922c09449f3e5`.

## Delivery boundary

Ship the GitHub scripts as NET 4.3.0 for explicit league adoption. Keep progbox's Published pointer on `v3.2.1`. This work does not migrate an existing league, update Dexter's old range display, create an npm package, or deploy a hosted progbox service. The [GitHub release](https://github.com/fearandesire/NoEyeTest/releases/tag/v4.3.0) is the distribution receipt once published.
