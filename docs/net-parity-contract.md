# NET simulation contract

Progbox forecasts one NET progression boundary from a league export. It uses the default WorkerConsole selection policy: players flagged at age 25 before preseason enter NET at age 26. A direct NET invocation can include an entering-age-25 player with `watch=1`; that is a different selection policy.

| Input | Contract |
|---|---|
| Export phase 0 / preseason | Export season is the entering season. Stats come from the preceding season; base ratings are the last row before the entering season. |
| Other export phases | Forecast the next season. Stats come from the export season; current ratings are the base. An in-season export is a snapshot forecast, not a completed-season result. |
| Candidate statistics | Last regular-season row in the stats season. Reject it if PER is zero; do not fall back to an earlier stint. |
| Published statistics | Mean PER of all nonzero regular-season rows in the stats season. A single row uses JavaScript `Math.fround`, matching the pinned Published script. |
| Candidate reference pool | Active players and free agents (`tid >= -1`), valid birth year and a nonempty ratings history, entering age at least 25, nonzero selected PER including negatives. |
| Output targets | Entering age at least 26; not drafted in the stats season. A preseason snapshot requires two ratings rows before mutation; a one-row player still contributes to preparation. Candidate requires positive PER. Published preserves negative nonzero PER behavior. Team filters restrict targets only. |
| Player identity | Preserve unique nonnegative source `pid` values. If IDs are missing or duplicated, use original source-array indices for every player. Both versions use the same mapping. |
| Ratings | BBGM integer floor and clamp happen before OVR. Published and Candidate retain their own progression rules. |
| Randomness | Shared fixtures replay identical draws through the full JavaScript scripts and C++ math. Production C++ uses its seeded RNG; equal numeric seeds do not imply equal BBGM random streams. |

NET input normalization is performed once in `api/src/services/netInput.ts`. The engine receives the complete reference pool plus explicit target flags. Its raw `input.csv` records actual target inputs. `engine_metadata.json` and run metadata record `net-boundary-v1`, entering/stats seasons, counts, source phase, identity policy, and the executed binary’s SHA-256. The v4.1 legacy input path is unchanged.

The CLI’s unnormalized export loader remains a research path. Invoke the API for the input contract above; a direct CLI run without `_progbox_contract` does not establish live NET input parity. A historical run remains evidence of its original engine and input policy, not of the corrected implementation.

The parity fixture pins the original Published script and BBGM rating/OVR helpers. Deterministic replay verifies progression math; a disposable real BBGM league is the separate persistence and lifecycle acceptance check. Fresh comparative statistics must be generated from the corrected binary and this input contract before release claims are updated.
