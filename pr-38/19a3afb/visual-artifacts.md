# NET Lab visual verification

PR: https://github.com/fearandesire/progbox-ui/pull/38

Captured 2026-10-08 from the actual locally running Vue/Fastify application, using Chromium. No API response mocks or manufactured result data.

- Current revision: `19a3afb38bba5b9a92f7ae943cfe84b017610577`.
- Before revision: `44073105582d8acc1594d466591fddb4ff9fba91` (PR base).
- Desktop viewport: 1440 × 1000, full-page captures where appropriate.
- Phone viewport: 390 × 844.
- Isolated scratch data, pinned public NBA 2025-26 roster; league download hash and StatGen calibration gate verified by `pnpm lab setup`.
- The script-library demo upload is the built-in NET 4.3.0 plus a comment, intentionally creating a version collision. Its progression behavior is unchanged. The application assigned `net@4.3.1-draft.1` and preserved the original source.
- Results use the unmodified built-in NET 4.3.0 vs NET 3.2.1, default locked deep-mode sizes, seed 69. This is StatGen simulation, not a live BBGM season.

## Ordered frames

1. [Before: original simulation setup](before-setup.png). Only bundled progression versions; no NET Lab timing modes or script upload.
2. [After: NET Lab setup](new-test.png). Validated league, three timing modes and saved run preview.
3. [After: one-season mode](season-mode.png). Simulated season, 200 runs per script.
4. [After: right-now mode](quick-mode.png). File stats, no simulated games, 1,000 runs per script.
5. [Before: dashboard](before.png). Navigation contains Dashboard and New sim; NET Lab reports, history and script library do not yet exist. This is the absence baseline for those new workflows, not a fabricated earlier version of them.
6. [After: script library](scripts.png). Published, next-release and uploaded draft versions.
7. [After: version collision diff](script-diff.png). Smart diff shows the automatically bumped version against the original upload.
8. [After: phone setup](mobile-new-test.png). Timing cards and preview stack without horizontal page overflow.

## Verification

Browser interactions exercised script upload/version bump, opening the original-source diff, selecting season and quick modes, and phone layout. No JavaScript page errors observed in these flows. Every delivered screenshot was opened and visually inspected.

The PR's existing API, web, Lab and e2e-smoke CI checks passed at capture time. These are existing CI results, not a claim that the entire suite was rerun for this evidence-only update.

## Reproduction

Use Node 24 and the pinned pnpm 10.8.0. Run `pnpm install --frozen-lockfile`, `pnpm lab setup`, then `pnpm dev`. Use an isolated `LAB_DATA_DIR` consistently for setup, CLI runs and API. Run `pnpm lab run --script net-4.3.0 --baseline net-3.2.1 --mode deep`. Open `/lab`, `/lab/scripts`, `/lab/history` and the completed run's `/lab/runs/<id>` route. In proxy-based environments enable Node's supported environment-proxy handling for the league download.

## Retention

Media is retained on the public repository's separate `visual-evidence` branch. PR embeds use immutable commit-pinned raw GitHub URLs without signed tokens or expiration times. This branch is independent of the PR head and its deletion on merge. Keep the evidence branch; availability still depends on the public repository remaining available.

## Completed comparison

Run `20261008190816` finished in 371 seconds: **Worse, 2/7 checks vs 6/7**. NET Lab 0.3.0 at `19a3afb`, checks v2, StatGen `statgen-2026-10-08`. Locked defaults were preserved, including the 60-replicate no-script reference.

9. [Completed verdict](verdict.png).
10. [All seven balance checks](checks.png).
11. [Ten-season charts](charts.png).
12. [Run provenance](run-details.png).
13. [History](history.png), including the setup smoke run and full comparison.
14. [Phone verdict](mobile-verdict.png).

[Self-contained before/after carousel](before-after.html): download and open locally; Previous/Next buttons and left/right arrow keys work without network access. Ordered images above are its static fallback.

Additional browser checks passed for completed results, charts, history, Run again, and phone report overflow. `browser-checks.json` records the final successful checks; `result-provenance.json` records the observed comparison.

Capture setup issue: running both worktrees with shared dependency caches initially caused Vite's `Outdated Optimize Dep` response on the report route. The baseline server was stopped and the current server restarted; final report captures and assertions then passed with no page errors.

Observed existing copy discrepancy: the setup preview labels real stats as 2025-26, while the pinned roster name and persisted run details say 2024-25. The screenshots preserve the actual UI; no application code was changed in this evidence update.
