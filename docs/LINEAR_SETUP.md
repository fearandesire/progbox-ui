# Linear setup (optional / if we switch)

we're on GitHub Projects for now. this is here in case we move to Linear later. it maps our setup over and gives a ready-to-paste prompt for a Linear-connected agent.

## how our concepts map

| what we mean | GitHub | Linear |
|---|---|---|
| the release goal | label `v1.0` + Project #10 | a **Project** named "progbox-ui v1.0" with a goal |
| a weekly sprint | Milestone (e.g. "Sprint 1: ends Fri Jun 19") | a **Cycle** (Linear's native 1-week sprint) |
| a unit of work | Issue | Issue |
| the board | Project #10 | the Project's board view |

key difference: Linear has **Cycles** built for exactly our weekly cadence, so use Cycles for sprints instead of milestones. Linear Projects also have their own Milestones — use those for bigger v1.0 sub-goals if we ever want them, not for weeks.

## prompt to set it up

paste this into a Linear-connected agent (or Claude with the Linear MCP):

```
Set up Linear to mirror the progbox-ui plan.

1. In my Linear team, create a Project called "progbox-ui v1.0".
   Goal: a dashboard that's useful for reading sim results, not just running them —
   selectable NET script version, run/dashboard cards with at-a-glance aggregated
   data, run comparison (incl. cross-version), and brief in-app docs.

2. Enable 1-week Cycles. Create the current cycle "Sprint 1" ending Fri Jun 19.

3. Create these issues in the project. Put the first four in Sprint 1; leave
   "Run comparison" in the backlog. Add a "v1.0" label to all five.

   - "Sync latest chart changes into the UI"
     Bring the latest engine chart output into the dashboard so runs show current charts.
     Acceptance: latest charts render in run/dashboard view; no stale artifacts; works for a fresh run end-to-end.

   - "Add NET script version selector (v3.0 / v3.1 / v4.1)"
     Let users pick which NET script version a run uses (v4.1 = Shawn's current build).
     Acceptance: version dropdown in new-sim config; selection passed to runner; version recorded in metadata and shown on the run.

   - "Improve run cards: surface key aggregated stats"
     Dashboard and per-run cards should show impactful, at-a-glance data.
     Acceptance: cards show key aggregated stats (not just IDs/timestamps); consistent across list and per-run; stats aid a quick read.

   - "Add a brief in-app docs page"
     Short docs explaining what outputs/metrics mean.
     Acceptance: reachable from nav; covers main outputs (charts, player table, god-progs, analysis); brief.

   - "Run comparison: side-by-side, cross-version" (backlog)
     Compare 2+ runs side-by-side, including across NET versions. Builds on the run-cards work.
     Acceptance: select 2+ runs; aggregated stats side-by-side; cross-version supported; clear deltas.

4. Show me the project URL and the cycle when done.
```
