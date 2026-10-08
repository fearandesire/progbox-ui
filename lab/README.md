# NET Lab

Drop in any NET progression script and find out what it does to a league: a one-screen verdict, a full report for people, and JSON for agents. The script runs unchanged, against a stand-in for BBGM's Worker Console `bbgm` object.

Two modes, **deep** by default:

| Mode | What it plays | Locked size |
| --- | --- | --- |
| Quick | The next offseason only, on the league's real stats, many seeds | 1000 offseasons |
| Deep | Quick, plus 10 offseasons in a row: each later season gets fresh stats from StatGen, BBGM-style development, retirements, a draft and roster moves | 200 replicates × 10 seasons |

Sizes are locked so every report is comparable; `--unlock` overrides them. Why these numbers: `src/presets.ts` (also printed in every manifest).

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

pnpm lab run --script wip.js --mode quick         # next offseason only
pnpm lab estimate --script wip.js --baseline net-3.2.1
pnpm lab replay outputs/lab/runs/<run>/manifest.json   # must print REPLAY MATCH
pnpm lab runs                                      # history
```

The web app has the same flow at `/lab` (`pnpm dev`). Locally and in the cloud it calls this CLI, so results match. To host it, see [AGENTS.md](AGENTS.md#host-it-cloud) (root `Dockerfile`).

## Scripts: forced names and versions

Every script that enters the Lab gets an immutable id, `family@version`:

- `| v4.4.0` in the header names the version. Without one, or when that version already holds other code, the script becomes the next draft: `net@4.4.0-draft.3`.
- The same code always maps to the same id, and an id never points at different code.
- Builtins: `net@3.2.1` (published), `net@4.3.0` (candidate), `hook@1.0.0` (the WorkerConsole pre-progs hook). The old names `net-3.2.1`, `net-4.3.0` and `worker-console` still work.

```bash
pnpm lab scripts add wip.js            # Saved as net@4.4.0-draft.1
pnpm lab scripts promote net@4.4.0-draft.1 candidate
pnpm lab scripts list
```

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
| `summary.md` | People: verdict, flags, headline numbers, multi-season table, risers, fallers, biggest script-to-script differences |
| `report.json` | Agents: KPIs, flags, league issues, deep per-season stats, `bbgm` API calls, News Feed event types, errors |
| `players.csv`, `players.baseline.csv` | Per-player ΔOVR mean, SD, quantiles, god-prog rate, mean Δ per rating |
| `deep.json` | Per-season series and each starting player's OVR trajectory (mean, p10, p90) |
| `manifest.json` | Audit: script ids and hashes, league URL and hash, fixes, imputed fields, presets, StatGen version and calibration, seeds, runtime |
| `status.json` | Live state for the app |

The verdict is `Hold` (errors, broken ratings, nobody progressed), `Review flags` or `No flags`. Flags point at where to look; they are not release gates (`src/report.ts`, `src/deepAnalyze.ts`).

## Accuracy checks

- `pnpm test:lab`: shim, determinism, registry, validation, StatGen identities and gate, deep replicate determinism, and our BBGM-compatible helpers against recorded BBGM outputs.
- `pnpm lab:crosscheck`: NET 3.2 and 4.3 through NET Lab and through the C++ engine on the same export; every player's mean ΔOVR must agree within 4 standard errors. CI runs it on every push.

## Limits

- The `bbgm` stand-in covers what NET 3.2 and 4.3 use. Anything else stops the run with the exact API name; add it in `src/shim.ts`.
- `develop(p, 0)` recomputes OVR exactly and sets `pot = ovr` at 29+; younger `pot` is left as-is.
- Deep mode has no trades, contracts or injuries beyond what playing-time resampling carries.
- `node:vm` keeps scripts out of the harness's globals but is not a security sandbox. Hosted, run the Lab in its own container.
- No BBGM source is included. `src/compat.ts` is our own implementation of the BBGM behaviors scripts rely on (OVR formula, rating clamp, random helpers), checked against recorded BBGM outputs in `src/fixtures/compat-golden.json`.
