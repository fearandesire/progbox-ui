# Handoff: NET Lab v2 (PR #38)

State on 2026-10-08, branch `claude/project-thread-0pk7hu`, draft PR #38. Work stopped early (usage limit). Everything below is committed and pushed.

## Read first
- `lab/AGENTS.md`: how NET Lab works, CLI, hosting, and the zengm phase-order references.
- `lab/CHANGELOG.md`: Lab 0.3.0 and checks v1.
- Approved prototype and plan (source of truth for UI and copy): https://claude.ai/artifact/9xyaXM5rqmV1CcPs6P9x83 (v7). Its Plan section maps every one of Fenix's comments to a change.

## Rules from Fenix (binding)
- No Claude/AI attribution in commits, PRs or code (no Co-Authored-By, session links, footers).
- No deploy without Fenix's explicit go. The app has no auth; it needs Cloudflare Access or similar in front.
- Never host or commit BBGM/zengm code. StatGen is our own model fit to BBGM output.
- New features: clickable prototype + plan first, then Fenix's go. (This build was approved 2026-10-08.)
- UI copy: short labels, detail in tooltips; no pill/chip badges; no yellow for neutral info; no em dashes.
- Every run records Lab version + commit, checks version + rules hash, StatGen version, so changes to grading can be judged (`pnpm lab regrade <run>`).

## What landed (commits on top of 54bc484)
| Commit | What |
|---|---|
| d851765 | UI: New test with Run preview and three timing cards, checks report, Scripts tab (`/lab/scripts`) with delete/undo/export/diff dialog, History Lab column + Run again |
| 580a0df | Engine: `season` mode, `lab/src/verdict.ts` (7 checks, 2-SE ties, verdict), Lab version metadata, `regrade`, registry trash/restore/export, line diff |
| a499c38 | API: `DELETE/POST restore/GET source/GET diff` for scripts, season mode, Lab version in history |
| c2a8607 | History shows check result as text (no pills), phone top bar fix, `LAB_COMMIT` Docker build arg |
| 726048d | Season mode graded on the offseason after the simulated season; `basis` per check; zengm refs in `lab/AGENTS.md` |
| af0a932 | Report says which data each check read |

Modes: `deep` = every offseason, 10 seasons (default); `season` = play this season with StatGen, then NET once; `quick` = NET now on the file's stats, no games played.

## Verified
- `pnpm run check` and `pnpm test` pass at af0a932: web 183 tests, api 128, lab 40.
- Real runs (scratch data, `LAB_DATA_DIR`): deep 4.3.0 vs 3.2.1 gives Worse, 2/7 vs 6/7, same pass/fail as the prototype; season and quick runs on nba-2025-26 and progbox-2017; `replay` matches; CLI scripts add/list/diff/export/delete/restore behave.
- One real season run started from the UI (net@4.3.1-draft.1 vs net@4.3.0) finished in 78 s with verdict Mixed.

## Open items, in order
1. **Run page after a live run:** in the end-to-end test the run finished (`status.json` state done, verdict mixed) but the page did not show the verdict heading within 4 minutes. Check that `LabRunView.vue` reloads the report when polling sees `done`, and what the heading text is for `mixed`. Reproduce: `LAB_DATA_DIR=<dir> pnpm dev`, open `/lab`, pick "After one season", Run test.
2. **Applicable counts differ between scripts** in that run (script 2/3, baseline 2/4). Find which check is n/a for one side only in `lab/src/verdict.ts` (likely aging with too few players in a band, or a missing SE) and make applicability the same for both sides, or explain it in the report.
3. Push nothing else to the PR description until checked: update the PR #38 body to cover v2 (modes, checks, Scripts tab, versions, regrade).
4. Wait for CI on the pushed head and fix anything red.
5. Later, needs Fenix: hosting decision; review akshay's next NET version when supplied.

## How to run
```
pnpm install
pnpm run check && pnpm test
LAB_DATA_DIR=/tmp/lab pnpm dev            # API :8000, web :5173, Lab at /lab
pnpm lab run --script net-4.3.0 --baseline net-3.2.1 --mode season
pnpm lab regrade <runId>
pnpm lab scripts list
```
