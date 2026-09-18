# progbox-ui — roadmap

planning is done week-by-week. issues live in [GitHub Projects (#10)](https://github.com/users/fearandesire/projects/10). this doc is the high-level view; the board is the source of truth for status.

---

## the goal: v1.0

a dashboard that's genuinely useful for reading sim results — not just running them. for v1.0 that means:

- run sims with a selectable progression script (`v321` / NET 3.2 published, `v43` candidate, `v41` legacy)
- run + dashboard cards that surface impactful, at-a-glance data
- compare runs against each other, including published vs candidate pairs (shipped)
- brief in-app docs so the outputs aren't a mystery

everything tagged [`v1.0`](https://github.com/fearandesire/progbox-ui/labels/v1.0) on the repo is in scope for the release.

---

## how we plan

- one week at a time, no further out than that
- each week = a small milestone of tightly-scoped, shippable issues
- the board (#10) tracks status; this doc tracks intent
- backlog below gets pulled into a sprint when we're ready

---

## current sprint — [Sprint 1: ends Fri Jun 19](https://github.com/fearandesire/progbox-ui/milestone/1)

| # | item |
|---|------|
| [#18](https://github.com/fearandesire/progbox-ui/issues/18) | sync latest chart changes into the UI |
| [#19](https://github.com/fearandesire/progbox-ui/issues/19) | NET script version selector (`v321` / `v41` / `v43`) |
| [#20](https://github.com/fearandesire/progbox-ui/issues/20) | improve run cards — key aggregated stats |
| [#21](https://github.com/fearandesire/progbox-ui/issues/21) | brief in-app docs page |

---

## backlog

unscheduled — pulled into a sprint when ready.

- ~~[#22](https://github.com/fearandesire/progbox-ui/issues/22) **run comparison** — side-by-side, cross-version~~ **shipped** (auto-compare pairs + `/compare`; published vs candidate framing).

---

## out of scope

see [scope doc](SCOPE.md). short version: we're not touching sim logic, not building for end users, not hosting this anywhere.
