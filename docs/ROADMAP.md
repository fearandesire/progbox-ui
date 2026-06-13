# progbox-ui — roadmap

planning is done week-by-week. we do a quick sync on sundays to set the next week's focus. issues are tracked in [GitHub Projects](../../projects).

---

## how we plan

- one week at a time, no further
- each week has a small set of issues — scoped tightly, shippable
- milestones map to weeks (e.g. `week of 2026-06-16`)
- backlog lives below — items get pulled into the current week on sundays

---

## current week — 2026-06-16

| # | item | notes |
|---|------|-------|
| 1 | sync latest chart changes into UI | carry over from recent engine updates |
| 2 | script version selector | support v3.0, v3.1, v4.1 (Shawn's build) |
| 3 | improve run cards — clearer, more impactful data | aggregated stats that actually help you read a result |

---

## backlog

items here are unscheduled — gets pulled into a week when we're ready.

- **run comparison** — compare two or more runs side-by-side, including cross-version (e.g. v3.1 vs v4.1 results on the same export)
- **docs page** — brief in-app docs explaining what each output/metric means
- **per-run card improvements** — build on top of the current week's card work; deeper aggregated insights

---

## out of scope

see [scope doc](SCOPE.md) for the full picture. short version: we're not touching sim logic, not building for end users, not hosting this anywhere.
