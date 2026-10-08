# NET Lab: setup and use for agents

Follow these steps in order. Each one has a check; don't move on until it passes.

## 1. Set up

| Step | Command | Passes when |
| --- | --- | --- |
| Node 22.18+ | `node -v` | v22.18 or newer (the Lab runs TypeScript directly) |
| Install | `pnpm install` (repo root) | exits 0 |
| Guided setup | `pnpm lab setup` | prints `NET Lab is ready` |

`pnpm lab setup` checks the data dir, downloads the pinned leagues (needs github.com), checks that the StatGen model passed its calibration gate, validates the default league, and runs a 20-offseason, 2-season smoke test. A failed step prints `fix:` with the next action.

Optional, for the app: `pnpm dev`, then open `http://localhost:5173/lab`. The page calls the same CLI.

Data lives in `outputs/lab/` unless `LAB_DATA_DIR` points elsewhere (use a persistent volume when hosted).

## 2. Test a script

```bash
pnpm lab run --script <file> --baseline net-3.2.1 --json > events.ndjson
```

- The script gets a forced id like `net@4.4.0-draft.1`; quote that id, not the filename. If the header's version already holds other code, the id is bumped (for example `net@4.3.1-draft.1`) and an `issue` event with code `version-bumped` says so; report the bumped id.
- `--json` prints one event per line: `run` (id, measured estimate), `stage`, `progress`, `issue` (league checks), `done` or `error`.
- Pick when NET runs with `--mode`: `deep` (default, every offseason for 10 seasons), `season` (plays out this season, then NET once) or `quick` (once, right now, on the file's stats). Only `deep` grades the three league-level checks.
- Each check in `report.checks.items` has a `basis`: `file-stats` (the file's own stats over many seeds, the quick part), `simulated-season` (NET's run after the simulated season; `season` mode grades everything from it and skips the quick part) or `multi-season`. Say which when you quote a number.
- The first deep or season run on a league also builds a cached no-script reference (60 replicates); later runs reuse it. `--no-reference` skips it.
- Read results from the run folder named in the `done` event: start with `report.json` (`checks.verdict`, `checks.items`, `runDetails`, `lab`, then `flags`, `script.kpis`, `deep.script.seasons`), then `summary.md` for people.
- Don't pass `--runs`, `--seasons` or `--replicates`; sizes are locked. Use `--unlock` only when asked, and say so in your write-up.

## How the deep and season loop plays a year

Each simulated year in `deep` and `season` mode (`src/deep.ts`) runs in BBGM's order, checked against zengm at commit `f3dac650b3250ed324eca5210feeb3ca5b441de5`, the commit StatGen was fit on:

1. **Season stats**: StatGen draws a regular season's box score and advanced stats for every rostered player (BBGM plays the games; the Lab can't host BBGM).
2. **Retirements**: StatGen's retirement rates by age and OVR. In BBGM: `player.shouldRetire` / `player.retire` in [newPhaseBeforeDraft.ts](https://github.com/zengm-games/zengm/blob/f3dac650b3250ed324eca5210feeb3ca5b441de5/src/worker/core/phase/newPhaseBeforeDraft.ts).
3. **Draft**: a class resampled from real BBGM classes, two rounds, worst teams first. In BBGM: [newPhaseDraft.ts](https://github.com/zengm-games/zengm/blob/f3dac650b3250ed324eca5210feeb3ca5b441de5/src/worker/core/phase/newPhaseDraft.ts).
4. **Develop**: each player gets a new ratings row for the next season with a development step resampled from real BBGM progs for his age (StatGen's model fit to BBGM's progs). In BBGM: `player.addRatingsRow` then `player.develop(p, 1, false, coachingLevel)` in [newPhasePreseason.ts](https://github.com/zengm-games/zengm/blob/f3dac650b3250ed324eca5210feeb3ca5b441de5/src/worker/core/phase/newPhasePreseason.ts).
5. **Hook**: the Worker Console pre-progs hook (`hook@1.0.0`) runs with last season's ages.
6. **NET**: the script runs in the new preseason, after BBGM-style progression.

That matches what NET's own README asks for: run the Worker Console code before progs, and NET in the preseason after BBGM's progression. `deep` runs NET at the file's own preseason first (real stats), then repeats steps 1 to 6 for each later season. `season` runs steps 1 to 6 once and grades that offseason. The links are references only; no zengm code is in this repo.

## 3. Report back

Lead with the checks verdict (`checks.verdict`: better, worse or mixed vs the baseline) and which checks pass or fail, then the flags. Then the numbers that changed most vs the baseline (mean ΔOVR, god progs per offseason, 75+ players after 10 seasons, age curve). Link `summary.md` and quote the run id, the script ids and the Lab and checks versions (`report.lab`) so anyone can `pnpm lab replay <manifest>`.

## 4. Old runs and rule changes

- `pnpm lab regrade <runId>` grades a saved run with today's checks and prints the old and new verdict side by side (`--json` for the object; it also writes `regrade.json`). Nothing is re-simulated.
- Changing a pass rule in `src/verdict.ts` means: bump `CHECKS_VERSION`, update the pinned hash in `src/verdict.test.ts`, and add a line to `CHANGELOG.md` saying what changed and why. Changing the simulation or how numbers are computed bumps `LAB_VERSION` in `src/version.ts`, with a CHANGELOG line too.

## 5. Manage scripts

| Command | Does |
| --- | --- |
| `pnpm lab scripts list` | Every version with role, source, upload name, runs, hash, header line and bump details (JSON) |
| `pnpm lab scripts export <id> [--original] [--out f]` | The exact stored file, or the original upload of a bumped version |
| `pnpm lab scripts diff <id> [--against original\|<id>]` | Line diff vs the original upload (default for bumped versions) or another version |
| `pnpm lab scripts delete <id> [--runs]` | Drafts only. Moves the file (and with `--runs`, the runs that tested it) to the trash for 7 days. Exit code 3 means locked (candidate, published or built in), 4 means not found |
| `pnpm lab scripts restore <id>` | Undo a delete within 7 days |

Don't delete scripts or runs unless asked. A deleted id never points at different code; the same code uploaded again gets it back.

## When something fails

| Message | Do |
| --- | --- |
| `bbgm.X is not supported by NET Lab yet` | The script uses an API the shim lacks. Add it to `src/shim.ts` with a test; don't edit the script. |
| `League ... can't be used` | Read the listed errors; they name the missing data. Fix the export or pick another league. |
| `League ... isn't downloaded yet` | `pnpm lab leagues fetch` |
| StatGen gate failed | Rebuild the model on a machine you own: `bash lab/local-runner/run-corpus.sh` (Node 24, about 15 minutes, runs BBGM locally). Never run BBGM on a server other people can reach. |
| `REPLAY MISMATCH` | Something non-deterministic slipped in. Treat it as a bug; compare the two `report.json` files. |
| `... is built in and can't be deleted` / `only drafts can be deleted` | Expected: releases are locked. Change the status with `scripts promote` first, and only if asked. |

## Host it (cloud)

The repo root `Dockerfile` builds one container: the API on 127.0.0.1:8000 and the built app on `$PORT` (8080), started by `deploy/start.sh`. Mount a volume at `/data`; runs, uploaded scripts, leagues and timings live there (`LAB_DATA_DIR=/data/lab`).

```bash
docker build -t progbox-ui .
docker run -p 8080:8080 -v progbox-data:/data progbox-ui
```

- The app has no login. Put it behind an auth proxy (Cloudflare Access or similar) before sharing the URL.
- The image contains no BBGM code. Deep mode uses `lab/models/statgen.json`; rebuild that model only on your own machine.
- Run estimates come from timings on the host they ran on, so the first run on a new host probes briefly.
- The image has no `.git`, so pass the commit at build or run time (`-e LAB_COMMIT=$(git rev-parse --short HEAD)`) to record it in each run.
