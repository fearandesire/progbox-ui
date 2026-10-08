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
- Read results from the run folder named in the `done` event: start with `report.json` (`verdict`, `flags`, `script.kpis`, `deep.script.seasons`), then `summary.md` for people.
- Don't pass `--runs`, `--seasons` or `--replicates`; sizes are locked. Use `--unlock` only when asked, and say so in your write-up.

## 3. Report back

Lead with the verdict and flags. Then the numbers that changed most vs the baseline (mean ΔOVR, god progs per offseason, 75+ players after 10 seasons, age curve). Link `summary.md` and quote the run id and script ids so anyone can `pnpm lab replay <manifest>`.

## When something fails

| Message | Do |
| --- | --- |
| `bbgm.X is not supported by NET Lab yet` | The script uses an API the shim lacks. Add it to `src/shim.ts` with a test; don't edit the script. |
| `League ... can't be used` | Read the listed errors; they name the missing data. Fix the export or pick another league. |
| `League ... isn't downloaded yet` | `pnpm lab leagues fetch` |
| StatGen gate failed | Rebuild the model on a machine you own: `bash lab/local-runner/run-corpus.sh` (Node 24, about 15 minutes, runs BBGM locally). Never run BBGM on a server other people can reach. |
| `REPLAY MISMATCH` | Something non-deterministic slipped in. Treat it as a bug; compare the two `report.json` files. |

## Host it (cloud)

The repo root `Dockerfile` builds one container: the API on 127.0.0.1:8000 and the built app on `$PORT` (8080), started by `deploy/start.sh`. Mount a volume at `/data`; runs, uploaded scripts, leagues and timings live there (`LAB_DATA_DIR=/data/lab`).

```bash
docker build -t progbox-ui .
docker run -p 8080:8080 -v progbox-data:/data progbox-ui
```

- The app has no login. Put it behind an auth proxy (Cloudflare Access or similar) before sharing the URL.
- The image contains no BBGM code. Deep mode uses `lab/models/statgen.json`; rebuild that model only on your own machine.
- Run estimates come from timings on the host they ran on, so the first run on a new host probes briefly.
