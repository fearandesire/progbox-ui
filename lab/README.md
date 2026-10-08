# NET Lab

Drop in any NET progression script and find out what it does to a league: a one-screen verdict, a full report for people, and JSON for agents. The script runs unchanged, against a stand-in for BBGM's Worker Console `bbgm` object.

Three modes, chosen by when NET runs. **Deep** is the default:

| Mode | When NET runs | What it plays | Locked size |
| --- | --- | --- | --- |
| `deep` | Every offseason, 10 seasons | The next offseason on the league's real stats, then 9 more: each later season gets fresh stats from StatGen, BBGM-style development, retirements, a draft and roster moves | 200 replicates × 10 seasons |
| `season` | Once, after one season | Plays out the season in progress with StatGen (development, retirements, draft), then runs NET once at the next preseason. A mid-season file's partial stats give way to a full simulated season | 200 replicates × 1 season |
| `quick` | Once, right now | The next offseason only, on the stats in the file; no games played | 1000 offseasons |

`deep` and `quick` both run the quick part (1000 offseasons on the file's own stats); it feeds the per-player tables and three of the checks below. `season` has no quick part: its tables and checks all come from NET's run after the simulated season. How a simulated year maps to BBGM's phases, with zengm links: [AGENTS.md](AGENTS.md#how-the-deep-and-season-loop-plays-a-year). Sizes are locked so every report is comparable; `--unlock` overrides them. Why these numbers: `src/presets.ts` (also printed in every manifest).

## Set it up

```bash
pnpm install
pnpm lab setup        # checks Node, downloads leagues, checks the StatGen model, runs a short smoke test
```

Agents: follow [AGENTS.md](AGENTS.md); every step prints what it checked and how to fix a failure.

## Run it

```bash
# Default: deep mode on the real 2025-26 NBA league, vs NET 3.2
pnpm lab run --script path/to/wip.js --baseline net-3.2.1

pnpm lab run --script wip.js --mode season        # after one simulated season
pnpm lab run --script wip.js --mode quick         # right now, on the file's stats
pnpm lab estimate --script wip.js --baseline net-3.2.1
pnpm lab replay outputs/lab/runs/<run>/manifest.json   # must print REPLAY MATCH
pnpm lab regrade <runId>                           # today's checks on a saved run, beside its old verdict
pnpm lab runs                                      # history (with each run's Lab and checks version)
```

The web app has the same flow at `/lab` (`pnpm dev`). Locally and in the cloud it calls this CLI, so results match. To host it, see [AGENTS.md](AGENTS.md#host-it-cloud) (root `Dockerfile`).

## Scripts: forced names and versions

Every script that enters the Lab gets an immutable id, `family@version`:

- `| v4.4.0` in the header names the version; uploads are drafts of it (`net@4.4.0-draft.1`). Without a header version, the script becomes the next draft of the latest version.
- If the header names a version that already holds different code, the version is forced up to the next free patch (`v4.3.0` → `net@4.3.1-draft.1`). The stored copy's header is rewritten to match, your original upload is kept beside it, and the upload response, the run's events and its manifest all say so.
- The same code always maps to the same id, and an id never points at different code.
- Builtins: `net@3.2.1` (published), `net@4.3.0` (candidate), `hook@1.0.0` (the WorkerConsole pre-progs hook). The old names `net-3.2.1`, `net-4.3.0` and `worker-console` still work.

```bash
pnpm lab scripts add wip.js            # Saved as net@4.4.0-draft.1
pnpm lab scripts promote net@4.4.0-draft.1 candidate
pnpm lab scripts list                  # JSON: id, role, builtin, source, uploadedFile, uploadedAt, runs, sha256, header, bumped
pnpm lab scripts export net@4.3.1-draft.1 [--original] [--out f.js]   # the stored file, or your upload of a bumped version
pnpm lab scripts diff net@4.3.1-draft.1 [--against original|net@4.3.0]  # line diff
pnpm lab scripts delete net@4.4.0-draft.1 [--runs]   # drafts only; --runs also trashes the runs that tested it
pnpm lab scripts restore net@4.4.0-draft.1
```

Deleting moves a draft (and with `--runs`, its runs) to `trash/` in the data dir for 7 days; it's purged the next time the registry loads after that. Candidate (next release), published and built-in scripts are locked: change the status first. A deleted id is never given to different code; uploading the same code again brings the id back, even after the purge. The API has the same calls under `/api/lab/scripts/:id` (`DELETE ?runs=1`, `POST /restore`, `GET /source?original=1`, `GET /diff?against=`); a locked script answers 409.

## Leagues

| Id | League |
| --- | --- |
| `nba-2025-26` (default) | Real NBA 2025-26 rosters at Opening Night with 2024-25 stats, by [alexnoob](https://github.com/alexnoob/BasketBall-GM-Rosters) (release 2026.0.5). Downloaded by `pnpm lab leagues fetch` and pinned by SHA-256; not stored in this repo. |
| `progbox-2017` | `data/export.json`, the progbox default export |

`pnpm lab leagues add export.json` stores an upload by content hash; `pnpm lab leagues check <id>` validates it. Validation runs before every run:

- **Errors stop the run:** no players, no season or phase, ratings rows missing any of the 15 ratings, no `born.year`, fewer than 2 active teams, fewer than 100 prior-season stat rows with PER, or a stat NET reads that can't be estimated.
- **Fixes are applied and recorded in the manifest**, the way BBGM's import does: season from `startingSeason`, pids in file order, missing `ovr`, empty stats lists, default draft info.
- **Imputed stats:** alexnoob's exports have no shot-zone stats or `minAvailable`, which NET 4.3 reads. StatGen estimates them from each row's real totals (zone attempts add up to real 2-point attempts, zone makes to real 2-point makes) and the report says how many rows were filled.

## StatGen: stats without hosting BBGM

BBGM's license allows running it only for yourself, so the hosted Lab never runs BBGM code. StatGen is our own statistical model of BBGM's output:

1. **Corpus.** `lab/local-runner/run-corpus.sh` plays real BBGM seasons on your own machine (3 leagues × 20 seasons: two random, one real-player) and writes JSONL data. Only data leaves the zengm clone.
2. **Fit.** `pnpm lab statgen fit` learns:
   - per-36 box-score rates from ratings, age and role, with correlated noise per minutes band;
   - advanced stats from the box score plus ratings. In BBGM's own output the box score explains 95-99.8% of the variance of PER, OBPM, ORtg, USG% and the rate stats, and 67-79% of DBPM, DRtg and DWS;
   - playing time by roster rank, development by age, retirement by age and OVR, and draft classes, all resampled from real BBGM outcomes.
3. **Gate.** On a league it never saw, StatGen gets each real player-season's ratings and minutes and must match what NET reads: every field's distribution within KS 0.10 and every pairwise correlation within 0.15. The current model passes (max KS 0.081, max correlation gap 0.141); the scores ship in `models/statgen.json` and in every deep manifest.

League-level check (no-op script, real-player league, 19 seasons): StatGen's league mean OVR tracks BBGM's within 0.6 OVR for the first 8 seasons, then settles about 1.3 OVR lower. Both scripts in a comparison share the same simulation, so this offsets absolute levels, not the comparison.

## Output

Each run writes `outputs/lab/runs/<id>/` (or under `LAB_DATA_DIR`):

| File | For |
| --- | --- |
| `summary.md` | People: versions, verdict, balance checks, run details, flags, headline numbers, multi-season table, risers, fallers, biggest script-to-script differences |
| `report.json` | Agents: `checks`, `runDetails`, `lab`, KPIs, flags, league issues, deep per-season stats, `bbgm` API calls, News Feed event types, errors |
| `players.csv`, `players.baseline.csv` | Per-player ΔOVR mean, SD, quantiles, god-prog rate, mean Δ per rating |
| `deep.json` | Per-season series and each starting player's OVR trajectory (mean, p10, p90) |
| `manifest.json` | Audit: Lab version and commit, checks version and rules hash, script ids and hashes, league URL and hash, fixes, imputed fields, presets, StatGen version and calibration, no-script reference, seeds, runtime |
| `status.json` | Live state for the app |

`report.json` also carries `lab` (versions), `runDetails` (when NET ran, which stats it read, runs, seed, script hashes) and `checks`; `summary.md` opens with the same verdict, checks table and run details. `regrade.json` appears after `pnpm lab regrade`.

## Balance checks and the verdict

Seven pass rules, in `src/verdict.ts`:

| Check | Unit | Passes when |
| --- | --- | --- |
| League average OVR holds | OVR change over 10 seasons | within 1.5 OVR of the start |
| Star count stays sane | players at 75+ OVR, start → season 10 | at most double the start |
| Superstars stay rare | players at 80+ OVR in season 10 | 3 or fewer |
| God progs stay rare | per offseason | 1 or fewer |
| Production drives progs | OVR gained per 1 SD better PER | +0.5 OVR or more |
| Progs are predictable | spread of a typical player's prog, OVR | 1.5 OVR or less |
| Players age normally | mean OVR change, ages 25 to 27 / 34+ | 25 to 27 at -0.5 or better, 34+ at -2 or worse |

- The first three need a 10-season run (`deep`); other modes mark them n/a. "Start" is the league before the first offseason.
- Each check records its `basis`, also shown as the Data column in `summary.md`:
  - `deep` and `quick`: god progs, production and predictability come from the quick part (`file-stats`); aging comes from the multi-season run in `deep` (`multi-season`).
  - `season`: god progs, production, predictability and aging all come from NET's run after the simulated season (`simulated-season`). Production pools every replicate's simulated PER against that replicate's ΔOVR, with its SE from the replicate-to-replicate spread. Predictability is each player's SD across replicates, so it also includes the spread of the simulated stats and is not directly comparable with the quick-mode number.
- Against a baseline: **Better** when no check the baseline passes is broken, **Worse** when more are broken than fixed, otherwise **Mixed**. A script vs baseline gap under 2 standard errors is a tie ("same"), so noise can't break a check. `change.pct` is the relative difference in size between the two scripts.
- The **No script** column comes from a reference run with the hook and BBGM-style development only (60 replicates), cached under `reference/` per league, Lab version, StatGen model, mode and size. `--no-reference` skips it.

The flags verdict (`Hold`, `Review flags`, `No flags`) stays in `report.verdict`: flags point at where to look; they are not release gates (`src/report.ts`, `src/deepAnalyze.ts`).

## Versions

Every run records `lab: { version, commit, checks: { version, rulesSha256 }, statgen }` in `manifest.json`, `report.json` and the top of `summary.md`; the run list shows the Lab and checks version. `LAB_VERSION` (`src/version.ts`) changes when the simulation or how numbers are computed changes; `CHECKS_VERSION` (`src/verdict.ts`) changes when a pass rule does, and a test pins the rules hash so an edit can't slip through. Each bump gets a line in [CHANGELOG.md](CHANGELOG.md). In a container without `.git`, set `LAB_COMMIT`.

`pnpm lab regrade <runId>` grades a saved run with today's rules from its `report.json` (and `players.csv`), prints the old and new verdict side by side and writes `regrade.json`. Nothing is re-simulated. Runs from before 0.3.0 had no start values; regrade rebuilds them from the league file when its hash still matches, else from the run's first season, and says so.

## Accuracy checks

- `pnpm test:lab`: shim, determinism, registry (versions, trash, restore, purge, export), line diff, validation, StatGen identities and gate, deep and after-one-season replicates, balance checks and verdict, regrade, and our BBGM-compatible helpers against recorded BBGM outputs.
- `pnpm lab:crosscheck`: NET 3.2 and 4.3 through NET Lab and through the C++ engine on the same export; every player's mean ΔOVR must agree within 4 standard errors. CI runs it on every push.

## Limits

- The `bbgm` stand-in covers what NET 3.2 and 4.3 use. Anything else stops the run with the exact API name; add it in `src/shim.ts`.
- `develop(p, 0)` recomputes OVR exactly and sets `pot = ovr` at 29+; younger `pot` is left as-is.
- The `season` and `deep` modes' later seasons are StatGen seasons, not BBGM's game sim; see StatGen above for how close they are.
- Deep mode has no trades, contracts or injuries beyond what playing-time resampling carries.
- `node:vm` keeps scripts out of the harness's globals but is not a security sandbox. Hosted, run the Lab in its own container.
- No BBGM source is included. `src/compat.ts` is our own implementation of the BBGM behaviors scripts rely on (OVR formula, rating clamp, random helpers), checked against recorded BBGM outputs in `src/fixtures/compat-golden.json`.
