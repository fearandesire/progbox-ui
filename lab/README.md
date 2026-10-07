# NET Lab

Run any NET progression script, unchanged, against a league export and get a short summary plus data for deeper analysis. No C++ port needed: the original JavaScript runs against a stand-in for BBGM's Worker Console `bbgm` object.

This is phase 0 of the NET Lab plan: quick mode (one offseason, many seeds). Deep mode, which plays several seasons with freshly generated stats, comes next.

## Run it

```bash
# From the repo root. Builtins: net-3.2.1 (Published), net-4.3.0 (Candidate), worker-console.
pnpm lab quick --script path/to/wip.js --baseline net-3.2.1

# Replay a run exactly and confirm it reproduces the same report.
pnpm lab replay outputs/lab/<run>/manifest.json
```

| Option | Default | Meaning |
| --- | --- | --- |
| `--script` | required | File or builtin under test |
| `--baseline` | none | File or builtin to compare against, same seeds |
| `--export` | `data/export.json` | League export |
| `--pre` | `worker-console` | Pre-progs hook, or `none` |
| `--runs` | `500` | Offseasons to simulate |
| `--seed` | `69` | Base seed |
| `--workers` | cores - 1 | Worker threads |
| `--out` | `outputs/lab` | Output root |

500 offseasons on the default export take about 75 seconds on 3 workers.

## What a run does

1. Reads the export. A preseason export is used as-is (BBGM progs already ran). For any other phase, the next preseason is emulated: the pre-progs hook runs in the current season, then each active or free-agent player's last ratings row is copied into the entering season, the way BBGM's `addRatingsRow` does.
2. Runs the script as the body of an async function with `bbgm` and a seeded `Math` in scope, exactly like the Worker Console.
3. Records every player the script wrote back with an entering-season row, and compares it to the prior-season base row.

## Output

Each run writes `outputs/lab/<YYYYMMDDHHmmss>/`:

| File | For |
| --- | --- |
| `summary.md` | People: verdict, flags, headline numbers vs baseline, risers, fallers, most volatile, biggest script-to-script differences |
| `report.json` | Agents: all KPIs, flags, `bbgm` API calls the script made, News Feed event types, errors |
| `players.csv` | Per-player mean, SD and quantiles of ΔOVR, god-prog rate, mean Δ per rating |
| `manifest.json` | Audit: script/baseline/hook SHA-256, export SHA-256, boundary seasons, seeds, BBGM helper revision, Node version, report hash |

The verdict is `Hold` (errors, broken ratings, nobody progressed), `Review flags` or `No flags`. Flags are heuristics for where to look, not release gates; thresholds live in `src/report.ts`.

## Accuracy checks

- `pnpm test:lab` covers the shim, determinism and health checks.
- `pnpm lab:crosscheck` runs NET 3.2 and 4.3 through NET Lab and through the C++ engine on the same export and compares every player's mean ΔOVR. CI runs it on every push. On the default export at 300 runs: 228/228 identical targets for both scripts, league mean ΔOVR within 0.01, and no player beyond 4 standard errors.

## Limits

- The `bbgm` stand-in covers what NET 3.2 and 4.3 use. Anything else stops the run with the exact API name (for example `bbgm.team is not supported by NET Lab yet`); add it in `src/shim.ts`.
- Players the script does not touch keep their prior ratings. BBGM's own `develop()` is not applied in quick mode.
- `develop(p, 0)` recomputes OVR exactly and sets `pot = ovr` at 29+; younger `pot` is left as-is because BBGM computes it with its own career simulation.
- `node:vm` keeps scripts out of the harness's globals but is not a security sandbox. Run untrusted scripts in a throwaway container.
- `vendor/bbgm/` holds unchanged BBGM helper sources, pinned by hash, with BBGM's license. The full BBGM engine is not part of this package.
