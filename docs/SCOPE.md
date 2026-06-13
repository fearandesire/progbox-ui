# progbox-ui — scope & goals

a local dashboard so we can run progbox sims and look at the results without touching the terminal every time.

---

## purpose, feature-set

- run sims — upload a league export, configure, fire it off
- view results — charts, player tables, analysis dashboard, god-progs, all in one place
- track past runs — browse history, see what changed between iterations
- faster feedback loop — the whole "tweak the script → understand the impact" cycle should be fast and visual, not spreadsheet-and-terminal

---

## what it's not // out-of-scope

- not re-inventing the wheel — BBGM Progs owns the sim logic, we just surface it
- not for league members or end users — internal tooling only
- not a hosted/cloud product — local, file-backed, no infra
