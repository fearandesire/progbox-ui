import type { ProgressionVersion } from "../progressionVersions.js";

type Row = Record<string, any>;
const object = (value: unknown): value is Row =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Convert a league snapshot into one explicit NET progression boundary. */
export function normalizeNetInput(
  data: Row,
  teamLookup: Record<string, string>,
  teams: string[],
  version: ProgressionVersion,
) {
  const season = Number(data.gameAttributes?.season);
  if (!Number.isInteger(season) || season < 1) throw new Error("NET requires an explicit integer export season");
  const preseason = data.gameAttributes?.phase === 0 || data.gameAttributes?.phase === "preseason";
  const enteringSeason = preseason ? season : season + 1;
  const statsSeason = enteringSeason - 1;
  const sourcePlayers: Row[] = Array.isArray(data.players) ? data.players : [];
  const ids = sourcePlayers.map(p => object(p) ? p.pid : undefined);
  const usePids = ids.every(id => Number.isSafeInteger(id) && id >= 0) && new Set(ids).size === ids.length;
  let targets = 0;
  const players = sourcePlayers.flatMap((p, index) => {
    if (!object(p)) return [];
    if (!Number.isInteger(p.tid) || p.tid < -1 || !Number.isInteger(p.born?.year) || p.born.year < 1) return [];
    const age = enteringSeason - p.born.year;
    if (age < 25 || !Array.isArray(p.ratings) || !p.ratings.length) return [];
    const ratings = p.ratings.filter((r: unknown) => object(r) && Number.isInteger(r.season) && r.season < enteringSeason);
    const base = ratings.at(-1);
    // Pool membership needs a ratings row, not the two-row mutation lifecycle.
    const poolRating = base ?? p.ratings.filter(object).at(-1);
    if (!poolRating) return [];
    const stats: Row[] = Array.isArray(p.stats) ? p.stats.filter((s: unknown) => object(s) && s.season === statsSeason && !s.playoffs) : [];
    const eligibleStats = version === "v3.2.1" ? stats.filter(s => typeof s.per === "number" && Number.isFinite(s.per) && s.per !== 0) : stats;
    if (!eligibleStats.length) return [];
    const selected = { ...eligibleStats.at(-1)! };
    if (typeof selected.per !== "number" || !Number.isFinite(selected.per) || selected.per === 0) return [];
    if (version === "v3.2.1") {
      selected.per = eligibleStats.length === 1
        ? Math.fround(eligibleStats[0]!.per)
        : eligibleStats.reduce((sum, s) => sum + s.per, 0) / eligibleStats.length;
    }
    if (selected.per === 0) return [];
    const target = Boolean(base) && (!preseason || p.ratings.length >= 2)
      && age >= 26
      && p.draft?.year !== statsSeason
      && (version === "v3.2.1" ? selected.per !== 0 : selected.per > 0)
      && (!teams.length || teams.includes(teamLookup[String(p.tid)] ?? ""));
    if (target) targets++;
    return [{ ...p, pid: usePids ? p.pid : index, ratings: [{ ...poolRating }], stats: [selected], _progbox_pool_only: !target }];
  });
  const contract = {
    id: "net-boundary-v1",
    entering_season: enteringSeason,
    stats_season: statsSeason,
    source_phase: data.gameAttributes?.phase ?? null,
    target_policy: "worker-console-default",
    pool_count: players.length,
    target_count: targets,
    player_id_policy: usePids ? "source-pid" : "source-index",
  };
  return { data: { ...data, gameAttributes: { ...data.gameAttributes, season: enteringSeason }, players, _progbox_contract: contract }, contract };
}
