import { ovr, RATING_KEYS } from "./compat.ts";
import { gameAttributesOf } from "./league.ts";

/**
 * League checks before any run. Errors stop the run; fixes are applied to the
 * export in memory and recorded in the manifest; warnings go in the report.
 */
export type Issue = { level: "error" | "warn" | "fix"; code: string; text: string };
export type Validation = { ok: boolean; issues: Issue[]; season: number; phase: number; imputed: string[] };

/** Stat fields NET 4.3 reads from the prior regular-season row. */
export const NET_STAT_FIELDS = ["per", "obpm", "dbpm", "stlp", "blkp", "usgp", "astp", "trbp", "orbp", "ortg", "gp", "min", "minAvailable", "fga", "fta", "tpa", "tp", "ft", "orb", "tov", "fgaAtRim", "fgAtRim", "fgaLowPost", "fgLowPost", "fgaMidRange", "fgMidRange"] as const;
/** Fields that can be imputed from the rest of the row when an export lacks them. */
export const IMPUTABLE = ["minAvailable", "fgaAtRim", "fgAtRim", "fgaLowPost", "fgLowPost", "fgaMidRange", "fgMidRange"] as const;

// minRoster is BBGM's default minRosterSize (defaultGameAttributes.ts), below which it signs free agents.
export const LIMITS = { minTeams: 2, minRoster: 10, minStatPool: 100 };

const lastValue = (v: unknown) => (Array.isArray(v) && v.length && v.every((x) => x && typeof x === "object" && "value" in x) ? (v.at(-1) as { value: unknown }).value : v);

/** Validate and normalize an export in place. */
export function validateLeague(data: Record<string, any>): Validation {
  const issues: Issue[] = [];
  const add = (level: Issue["level"], code: string, text: string) => issues.push({ level, code, text });
  const ga = gameAttributesOf(data);

  let season = Number(lastValue(ga.season));
  if (!Number.isInteger(season) && Number.isInteger(data.startingSeason)) {
    season = data.startingSeason;
    add("fix", "season-from-startingSeason", `No gameAttributes.season; using the export's startingSeason ${season}, as BBGM does on import.`);
  }
  const phase = Number(lastValue(ga.phase));
  if (!Number.isInteger(season)) add("error", "no-season", "Can't tell the league's season: no gameAttributes.season or startingSeason.");
  if (!Number.isInteger(phase)) add("error", "no-phase", "Can't tell the league's phase: gameAttributes.phase is missing.");
  // Write the resolved values back so every later step reads one source of truth.
  if (Number.isInteger(season)) setAttr(data, "season", season);

  const players: any[] = Array.isArray(data.players) ? data.players : [];
  if (!players.length) add("error", "no-players", "The export has no players.");

  // BBGM assigns pids in file order on import when they're missing.
  if (players.length && players.some((p) => !Number.isInteger(p?.pid))) {
    const used = new Set(players.map((p) => p?.pid).filter(Number.isInteger));
    let next = 0;
    let n = 0;
    for (const p of players) {
      if (Number.isInteger(p.pid)) continue;
      while (used.has(next)) next++;
      p.pid = next++;
      n++;
    }
    add("fix", "assigned-pids", `${n} players had no pid; assigned in file order like BBGM's import.`);
  }

  // BBGM gives every player a stats list on import; scripts call p.stats.filter(...) unguarded.
  const noStats = players.filter((p) => !Array.isArray(p.stats));
  for (const p of noStats) p.stats = [];
  if (noStats.length) add("fix", "empty-stats", `${noStats.length} players had no stats list; gave them an empty one like BBGM's import.`);
  const noDraft = players.filter((p) => !p.draft || typeof p.draft !== "object");
  for (const p of noDraft) p.draft = { year: Number(p.born?.year) + 19, round: 0, pick: 0, tid: -1 };
  if (noDraft.length) add("fix", "default-draft", `${noDraft.length} players had no draft info; set undrafted at age 19.`);

  let badRatings = 0;
  let filledOvr = 0;
  for (const p of players) {
    if (!Array.isArray(p.ratings) || !p.ratings.length) {
      if (p.tid >= -1) badRatings++;
      continue;
    }
    for (const r of p.ratings) {
      if (RATING_KEYS.some((k) => !Number.isFinite(Number(r[k])))) {
        if (p.tid >= -1) badRatings++;
        break;
      }
      if (!Number.isFinite(r.ovr)) {
        r.ovr = ovr(r);
        filledOvr++;
      }
    }
  }
  if (badRatings) add("error", "bad-ratings", `${badRatings} active or free-agent players have a ratings row missing one of the 15 ratings.`);
  if (filledOvr) add("fix", "computed-ovr", `${filledOvr} ratings rows had no ovr; computed with BBGM's formula.`);

  const missingBorn = players.filter((p) => p.tid >= -1 && !Number.isInteger(p?.born?.year)).length;
  if (missingBorn) add("error", "no-born", `${missingBorn} players have no born.year, so ages can't be computed.`);

  // Teams: BBGM needs at least two active teams with full rosters to play games.
  const teams: any[] = Array.isArray(data.teams) ? data.teams : [];
  const active = teams.filter((t) => !t?.disabled);
  if (active.length < LIMITS.minTeams) add("error", "few-teams", `Only ${active.length} active teams; a season needs at least ${LIMITS.minTeams}.`);
  const short = active
    .map((t) => ({ abbrev: t.abbrev ?? t.tid, n: players.filter((p) => p.tid === t.tid).length }))
    .filter((t) => t.n < LIMITS.minRoster);
  if (short.length) add("warn", "short-rosters", `${short.length} teams have under ${LIMITS.minRoster} players (${short.slice(0, 5).map((t) => `${t.abbrev} ${t.n}`).join(", ")}); BBGM fills them from free agents in multi-season runs.`);

  // Stats NET reads: last regular-season row of the season before the entering preseason.
  const entering = phase === 0 ? season : season + 1;
  const statsSeason = entering - 1;
  const rows = players.flatMap((p) => (Array.isArray(p.stats) ? p.stats.filter((s: any) => s?.season === statsSeason && !s.playoffs) : []));
  const pool = rows.filter((s) => Number(s.per) && Number(s.gp) > 0).length;
  if (pool < LIMITS.minStatPool) add("error", "small-stat-pool", `${pool} regular-season ${statsSeason} stat rows with PER; NET's comparisons need at least ${LIMITS.minStatPool}.`);

  const imputed: string[] = [];
  for (const f of NET_STAT_FIELDS) {
    const present = rows.filter((s) => s[f] !== undefined && s[f] !== null).length;
    if (rows.length && present === 0) {
      if ((IMPUTABLE as readonly string[]).includes(f)) imputed.push(f);
      else add("error", "missing-stat", `No ${statsSeason} stat row has "${f}", which NET reads.`);
    } else if (present < rows.length) {
      add("warn", "partial-stat", `${rows.length - present} of ${rows.length} ${statsSeason} rows lack "${f}"; NET reads those as 0.`);
    }
  }
  if (imputed.length) add("fix", "imputed-stats", `The export has no ${imputed.join(", ")}. NET reads them, so they're estimated from each row's other stats with the BBGM-calibrated model.`);

  return { ok: !issues.some((i) => i.level === "error"), issues, season, phase, imputed };
}

function setAttr(data: Record<string, any>, key: string, value: unknown) {
  if (Array.isArray(data.gameAttributes)) {
    const row = data.gameAttributes.find((a: { key: string }) => a.key === key);
    if (row) row.value = value;
    else data.gameAttributes.push({ key, value });
  } else {
    data.gameAttributes = { ...(data.gameAttributes ?? {}), [key]: value };
  }
}
