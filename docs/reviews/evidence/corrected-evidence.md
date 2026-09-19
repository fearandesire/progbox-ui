# Corrected NET release evidence

Recounted from full-precision raw rows, joined by stable `PlayerID`. Each pair uses 100 stochastic runs of one fixed roster. Run spread is **not** uncertainty across independent leagues.

| Cohort | Seed | Targets C/P/shared | Higher/lower/tied | Median Δ (C−P) | Drift C/P | Kendall τ (mean OVR) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| sample | 42 | 228/228/228 | 111/117/0 | -0.0350 | -0.8600/-0.9424 | 0.9354 |
| sample | 7 | 228/228/228 | 107/120/1 | -0.0600 | -0.8553/-0.9234 | 0.9361 |
| sample | 99 | 228/228/228 | 112/115/1 | -0.0200 | -0.8327/-0.9366 | 0.9327 |
| synthetic | 42 | 60/60/60 | 42/18/0 | 0.6300 | -2.2338/-2.8400 | 0.9395 |
| live | 42 | 3/4/3 | 1/2/0 | -1.1600 | -0.9567/-2.4850 | -0.3333 |

Paired counts and median use shared IDs only. Drift uses each version's full target set; its denominator differs in the live disposable league.

The same 228-player sample roster across seeds [42, 7, 99] had 107–112 higher Candidate means, median deltas -0.0600–-0.0200, and Kendall τ 0.9327–0.9361. These are repeat seeds, not independent league samples.

The run-to-run spread below is the distribution of league-average one-step deltas over 100 Monte Carlo executions of each **fixed** roster. The standard error describes simulation noise of that fixed-roster mean; it does not estimate league-to-league variation.

| Cohort | Seed | Candidate run SD / MC SE / 2.5–97.5% | Published run SD / MC SE / 2.5–97.5% |
| --- | ---: | ---: | ---: |
| sample | 42 | 0.131 / 0.013 / -1.147–-0.596 | 0.109 / 0.011 / -1.123–-0.752 |
| sample | 7 | 0.126 / 0.013 / -1.079–-0.618 | 0.115 / 0.011 / -1.114–-0.694 |
| sample | 99 | 0.134 / 0.013 / -1.057–-0.578 | 0.110 / 0.011 / -1.117–-0.702 |
| synthetic | 42 | 0.214 / 0.021 / -2.567–-1.758 | 0.187 / 0.019 / -3.151–-2.458 |
| live | 42 | 1.157 / 0.116 / -2.667–2.350 | 0.604 / 0.060 / -3.250–-0.856 |

- **sample seed 42:** age 25–27 shared 65 (higher/lower/tied 43/22/0); age 41 targets C/P 1/1. One-step zero crossing C 26.92 (observed ages 26–27; n 40/25), P 30.15 (observed ages 30–31; n 28/22).
  - Age cohorts with fewer than five players: C {'36': 2, '37': 3, '38': 1, '40': 2, '41': 1}; P {'36': 2, '37': 3, '38': 1, '40': 2, '41': 1}.
- **sample seed 7:** age 25–27 shared 65 (higher/lower/tied 40/24/1); age 41 targets C/P 1/1. One-step zero crossing C 26.91 (observed ages 26–27; n 40/25), P 30.14 (observed ages 30–31; n 28/22).
  - Age cohorts with fewer than five players: C {'36': 2, '37': 3, '38': 1, '40': 2, '41': 1}; P {'36': 2, '37': 3, '38': 1, '40': 2, '41': 1}.
- **sample seed 99:** age 25–27 shared 65 (higher/lower/tied 43/21/1); age 41 targets C/P 1/1. One-step zero crossing C 27.09 (observed ages 27–28; n 25/21), P 30.15 (observed ages 30–31; n 28/22).
  - Age cohorts with fewer than five players: C {'36': 2, '37': 3, '38': 1, '40': 2, '41': 1}; P {'36': 2, '37': 3, '38': 1, '40': 2, '41': 1}.
- **synthetic seed 42:** age 25–27 shared 12 (higher/lower/tied 11/1/0); age 41 targets C/P 0/0. One-step zero crossing C 26.20 (observed ages 26–29; n 12/12), P none.
- **live seed 42:** age 25–27 shared 1 (higher/lower/tied 1/0/0); age 41 targets C/P 0/0. One-step zero crossing C 26.92 (observed ages 26–30; n 1/2), P none.
  - Age cohorts with fewer than five players: C {'26': 1, '30': 2}; P {'26': 1, '30': 3}.
  - published_only: PlayerID 6 NETFixture negative-per (MIN, age 30); no paired delta.

The live Candidate crossing interpolates between ages 26 and 30 using only one and two players; it is not a robust estimate of a career peak. The disposable BBGM cohort is not a production league sample.

Every workbook Players mean/SD and Per Age mean matched the raw recount within 0.000051. Every comparison HTML table, scorecard CSV, JSON scorecard, and named JSON chart used requested script order; sample seed 42 was checked in both orders.

Endpoint and cached artifact hashes, per-run spread, all age counts, and per-player rows are in `corrected-evidence.json` and `corrected-player-deltas.csv`.

Reproduce from repository root: `.venv/bin/python outputs/release-review/recount-corrected.py --api-base http://127.0.0.1:18036`.
For local artifacts without a running API: `.venv/bin/python outputs/release-review/recount-corrected.py --offline` (writes separate `corrected-evidence-offline` reports without endpoint hashes).

The JSON identifies the final NoEyeTest source revision/hash, golden parity fixture, pinned BBGM helper revision/files, input exports, simulator binary, and analysis helper hashes. `net-candidate.js` and `net-published-main.js` are labeled historical review snapshots, not final source. This is local simulation evidence, not production league acceptance.
