# NET Lab changelog

Two version numbers, both recorded in every run (`manifest.json` `lab`, `report.json` `lab`, the top of `summary.md`, and the History list):

- **NET Lab version** (`LAB_VERSION` in `src/version.ts`): bump it when the simulation, StatGen use, or how a report's numbers are computed changes.
- **Checks version** (`CHECKS_VERSION` in `src/verdict.ts`): bump it when a pass rule changes. Every run also records `rulesSha256`, a hash of the exact thresholds, so an unbumped edit still shows up.

After a checks change, `pnpm lab regrade <runId>` shows any saved run under the new rules beside its old verdict, without re-simulating.

## NET Lab 0.3.0 (2026-10-08)

- New run mode `season` ("After one season"): plays out the season in progress with StatGen, then runs NET once at the next preseason. Same replicates as deep mode. A mid-season file's partial stats give way to a full simulated season.
- Balance checks and a Better / Worse / Mixed verdict against the baseline (`report.checks`, top of `summary.md`). The flags verdict (`Hold`, `Review flags`, `No flags`) stays as `report.verdict`.
- No-script reference: the same league with the pre-progs hook and BBGM-style development only, cached per league, Lab version, StatGen model, mode and size under `reference/` in the data dir. Fills the "No script" column. Skip it with `--no-reference`.
- `report.runDetails`: when NET runs, whether games were simulated, which stats NET read, league, runs, seed and script hashes.
- Lab metadata (version, git commit, checks version and rules hash, StatGen version) in the manifest, report, summary and run list. `report_sha256` leaves the commit out so a replay on another checkout can still match.
- Quick-mode KPIs gain standard errors (`godProgsSe`, `perEffectSe`, `deltaByAge[band].se`) and deep mode gains `ageCurveSe`, for the two-standard-error tie rule.
- `pnpm lab regrade <runId>` writes `regrade.json` beside the run.
- Script library: delete drafts to a 7-day trash (optionally with their runs), restore, export the stored file or the original upload, and line diffs (`pnpm lab scripts delete|restore|export|diff`, and the matching API routes). Deleted ids are never reused for other code; uploading the same code brings the id back.

## Checks v1 (2026-10-08)

First set of pass rules, taken from the approved Lab v2 prototype. On the 2025-26 NBA league, NET 3.2.1 (the published script) passes all but the star-count check:

| Check | Passes when |
| --- | --- |
| League average OVR holds | after 10 seasons, within 1.5 OVR of the start |
| Star count stays sane | 75+ OVR players after 10 seasons at most double the start |
| Superstars stay rare | 3 or fewer players at 80+ OVR in season 10 |
| God progs stay rare | 1 or fewer per offseason |
| Production drives progs | +0.5 OVR or more per 1 SD better PER |
| Progs are predictable | median per-player spread 1.5 OVR or less |
| Players age normally | ages 25 to 27 at -0.5 or better, 34+ at -2 or worse |

Why: the Lab needed a fixed, written-down answer to "is this script better than the release?" instead of heuristic flags alone.

Script vs baseline differences under 2 standard errors count as a tie. Better: no check the baseline passes is broken. Worse: more checks broken than fixed. Mixed: otherwise.

## NET Lab 0.2.0

Deep mode with StatGen, the real-NBA default league, forced script versions, and the Lab page.

## NET Lab 0.1.0

Quick mode: any NET script run as-is against a league export, with a report.
