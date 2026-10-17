// Copied into a local zengm clone as corpus.test.ts by run-corpus.sh; it only runs there.
// StatGen corpus generator. Runs the BBGM engine headlessly (private use only) and
// writes JSONL data. Env: SEED, LEAGUE_KIND (random|real), SEASONS, OUT, REAL_SEASON.
import "fake-indexeddb/auto";
import { test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { makeSeededRandom } from "./src/common/random.ts";

const SEED = Number(process.env.SEED ?? 1);
const LEAGUE_KIND = (process.env.LEAGUE_KIND ?? "random") as "random" | "real";
const SEASONS = Number(process.env.SEASONS ?? 1);
const OUT = process.env.OUT ?? "./corpus-out";
const REAL_SEASON = Number(process.env.REAL_SEASON ?? 2025);
const RANDOM_START = 2025;

// Seed BBGM's RNG: everything in the engine goes through Math.random.
Math.random = makeSeededRandom(SEED);

const RATING_KEYS = [
	"hgt", "stre", "spd", "jmp", "endu", "ins", "dnk", "ft", "fg", "tp",
	"oiq", "diq", "drb", "pss", "reb",
] as const;

const STAT_KEYS = [
	"gp", "gs", "min", "minAvailable", "fg", "fga", "fgAtRim", "fgaAtRim",
	"fgLowPost", "fgaLowPost", "fgMidRange", "fgaMidRange", "tp", "tpa", "ft",
	"fta", "orb", "drb", "ast", "tov", "stl", "blk", "ba", "pf", "pts", "pm",
	"dd", "td", "per", "ewa", "obpm", "dbpm", "bpm", "ows", "dws", "vorp",
	"usgp", "astp", "trbp", "orbp", "drbp", "stlp", "blkp", "ortg", "drtg",
	"pm100", "onOff100",
] as const;

const pickRatings = (r: any) => {
	if (!r) return null;
	const o: any = {};
	for (const k of RATING_KEYS) o[k] = r[k];
	o.ovr = r.ovr;
	o.pot = r.pot;
	o.pos = r.pos;
	o.skills = r.skills;
	if (r.injuryIndex !== undefined) o.injuryIndex = r.injuryIndex;
	return o;
};

const poss = (ts: any) =>
	0.5 *
	(ts.fga +
		0.4 * ts.fta -
		1.07 * (ts.orb / (ts.orb + ts.oppDrb || 1)) * (ts.fga - ts.fg) +
		ts.tov +
		(ts.oppFga +
			0.4 * ts.oppFta -
			1.07 * (ts.oppOrb / (ts.oppOrb + ts.drb || 1)) * (ts.oppFga - ts.oppFg) +
			ts.oppTov));

test("corpus", { timeout: 6 * 60 * 60 * 1000 }, async () => {
	const { league, finances } = await import("./src/worker/core/index.ts");
	const { g, helpers } = await import("./src/worker/util/index.ts");
	await import("./src/worker/index.ts");
	const { LEAGUE_DATABASE_VERSION, PHASE, PLAYER } = await import(
		"./src/common/constants.ts"
	);
	const { getDefaultSettings } = await import("./src/worker/views/newLeague.ts");
	const { last } = await import("./src/common/utils.ts");
	const { defaultGameAttributes } = await import(
		"./src/common/defaultGameAttributes.ts"
	);
	const { unwrapGameAttribute } = await import(
		"./src/common/unwrapGameAttribute.ts"
	);
	const { idb } = await import("./src/worker/db/index.ts");
	const { startAutoPlay } = await import("./src/worker/core/league/autoPlay.ts");
	const realRosters = (await import("./src/worker/core/realRosters/index.ts"))
		.default;

	fs.mkdirSync(OUT, { recursive: true });
	const files = {
		players: path.join(OUT, "players.jsonl"),
		teams: path.join(OUT, "teams.jsonl"),
		league: path.join(OUT, "league.jsonl"),
		progs: path.join(OUT, "progression.jsonl"),
		roster: path.join(OUT, "roster.jsonl"),
		timing: path.join(OUT, "timing.jsonl"),
	};
	for (const f of Object.values(files)) fs.writeFileSync(f, "");
	const write = (f: string, rows: any[]) => {
		if (rows.length) fs.appendFileSync(f, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
	};
	const leagueName = `${LEAGUE_KIND}-s${SEED}`;
	const log = (s: string) => {
		const line = `[${new Date().toISOString()}] ${leagueName} ${s}`;
		console.log(line);
		fs.appendFileSync(path.join(OUT, "run.log"), line + "\n");
	};

	// ---------- create league ----------
	const t0 = Date.now();
	const settings: any = getDefaultSettings();
	if (LEAGUE_KIND === "real") {
		const opts = {
			type: "real" as const,
			season: REAL_SEASON,
			phase: PHASE.PRESEASON,
			randomDebuts: false,
			randomDebutsKeepCurrent: false,
			realDraftRatings: "rookie" as const,
			realStats: "none" as const,
			includePlayers: true,
		};
		const info: any = await realRosters.getLeagueInfo(opts);
		// Same as the UI's getSettingsFromGameAttributes
		for (const key of Object.keys(settings)) {
			if (["noStartingInjuries", "randomization", "realStats", "giveMeWorstRoster"].includes(key)) continue;
			const value = unwrapGameAttribute(info.gameAttributes, key as any);
			if (value !== undefined) {
				settings[key] = key === "repeatSeason" ? (value as any)?.type : value;
			}
		}
		const realLeague = await realRosters.getLeague(opts);
		await league.createStream(realLeague as any, {
			confs: unwrapGameAttribute(info.gameAttributes, "confs"),
			divs: unwrapGameAttribute(info.gameAttributes, "divs"),
			fromFile: {
				gameAttributes: realLeague.gameAttributes,
				hasRookieContracts: true,
				maxGid: undefined,
				startingSeason: realLeague.startingSeason,
				teams: realLeague.teams,
				version: LEAGUE_DATABASE_VERSION,
			},
			getLeagueOptions: opts,
			keptKeys: new Set([...info.stores, "startingSeason", "version"]) as any,
			lid: 0,
			name: leagueName,
			setLeagueCreationStatus: () => {},
			settings,
			shuffleRosters: false,
			startingSeasonFromInput: undefined,
			teamsFromInput: info.teams,
			tid: 0,
		} as any);
	} else {
		await league.createStream(
			{},
			{
				confs: last(defaultGameAttributes.confs).value,
				divs: last(defaultGameAttributes.divs).value,
				fromFile: {
					gameAttributes: undefined,
					hasRookieContracts: true,
					maxGid: undefined,
					startingSeason: undefined,
					teams: undefined,
					version: LEAGUE_DATABASE_VERSION,
				},
				getLeagueOptions: undefined,
				keptKeys: new Set(),
				lid: 0,
				name: leagueName,
				setLeagueCreationStatus: () => {},
				settings,
				shuffleRosters: false,
				startingSeasonFromInput: String(RANDOM_START),
				teamsFromInput: helpers.addPopRank(helpers.getTeamsDefault()),
				tid: 0,
			} as any,
		);
	}
	await league.loadGameAttributes();
	log(`created in ${(Date.now() - t0) / 1000}s season=${g.get("season")} phase=${g.get("phase")}`);

	const base = { league: leagueName, seed: SEED };

	// ---------- progression snapshot (call at PRESEASON, after develop) ----------
	const recordProgs = async (season: number) => {
		const players = await idb.cache.players.indexGetAll("playersByTid", [PLAYER.FREE_AGENT, Infinity]);
		const teams = await idb.cache.teams.getAll();
		const coaching: Record<number, number> = {};
		for (const t of teams) {
			const teamSeasons = await idb.getCopies.teamSeasons(
				{ tid: t.tid, seasons: [season - 3, season - 1] },
				"noCopyCache",
			);
			coaching[t.tid] = await finances.getLevelLastThree("coaching", { t, teamSeasons });
		}
		const rows: any[] = [];
		for (const p of players) {
			const prevRows = p.ratings.filter((r: any) => r.season === season - 1);
			const newRow = p.ratings.find((r: any) => r.season === season);
			if (!prevRows.length || !newRow) continue;
			const prevLast = prevRows.at(-1);
			const prevFirst = prevRows[0];
			rows.push({
				...base,
				season,
				pid: p.pid,
				tid: p.tid,
				age: season - p.born.year,
				draftYear: p.draft.year,
				coachingLevel: coaching[p.tid] ?? null,
				prevOvr: prevLast.ovr,
				prevOvrSeasonStart: prevFirst.ovr,
				newOvr: newRow.ovr,
				prevPot: prevLast.pot,
				newPot: newRow.pot,
				prevRatings: pickRatings(prevLast),
				newRatings: pickRatings(newRow),
			});
		}
		write(files.progs, rows);
		return rows.length;
	};


	// ---------- full roster snapshot (every player in cache, incl. FA/undrafted) ----------
	const seenPids = new Map<number, number>(); // pid -> last season seen active
	const rosterRow = (p: any, season: number, snapshot: string) => {
		const r =
			p.ratings.filter((r: any) => r.season === season)[0] ?? p.ratings.at(-1);
		return {
			run: leagueName,
			...base,
			season,
			snapshot,
			pid: p.pid,
			tid: p.tid,
			age: season - p.born.year,
			draftYear: p.draft.year,
			draftRound: p.draft.round,
			draftPick: p.draft.pick,
			ratingsSeason: r?.season,
			ratings: pickRatings(r),
			injuryGamesRemaining: p.injury?.gamesRemaining ?? 0,
			injuryType: p.injury?.type,
			contractAmount: p.contract?.amount,
			contractExp: p.contract?.exp,
			rosterOrder: p.rosterOrder ?? null,
			ptModifier: p.ptModifier ?? null,
			retiredYear: p.retiredYear ?? null,
		};
	};
	const dumpRoster = async (season: number) => {
		const players = await idb.cache.players.getAll();
		const rows = players.map((p: any) => rosterRow(p, season, "endRegularSeason"));
		for (const p of players) if (p.tid !== PLAYER.RETIRED) seenPids.set(p.pid, season);
		write(files.roster, rows);
		return rows.length;
	};
	// At preseason: players seen last season but no longer active -> retired rows (tid -3)
	const dumpRetired = async (season: number) => {
		const active = new Set(
			(await idb.cache.players.getAll())
				.filter((p: any) => p.tid !== PLAYER.RETIRED)
				.map((p: any) => p.pid),
		);
		const rows: any[] = [];
		for (const [pid, last] of seenPids) {
			if (last !== season - 1 || active.has(pid)) continue;
			const p: any = await idb.getCopy.players({ pid }, "noCopyCache");
			if (!p) continue;
			rows.push(rosterRow(p, season - 1, "retiredOffseason"));
			seenPids.delete(pid);
		}
		write(files.roster, rows);
		return rows.length;
	};

	// ---------- end-of-regular-season dump (call at PLAYOFFS start) ----------
	const dumpSeason = async (season: number) => {
		const players = await idb.cache.players.getAll();
		const teamSeasons = (await idb.cache.teamSeasons.getAll()).filter((ts: any) => ts.season === season);
		const teamStats = (await idb.cache.teamStats.getAll()).filter(
			(ts: any) => ts.season === season && !ts.playoffs,
		);
		const teamsArr = await idb.cache.teams.getAll();
		const numGames = g.get("numGames");
		const gameLength = helpers.effectiveGameLength();

		// roster rank by ovr (current team, end of regular season)
		const rosterOvr: Record<number, { pid: number; ovr: number }[]> = {};
		for (const p of players) {
			if (p.tid < 0) continue;
			const r = p.ratings.findLast((r: any) => r.season === season) ?? p.ratings.at(-1);
			(rosterOvr[p.tid] ??= []).push({ pid: p.pid, ovr: r.ovr });
		}
		const rankOf: Record<number, number> = {};
		const teamOvrTop10: Record<number, number> = {};
		for (const [tid, arr] of Object.entries(rosterOvr)) {
			arr.sort((a, b) => b.ovr - a.ovr);
			arr.forEach((x, i) => (rankOf[x.pid] = i + 1));
			teamOvrTop10[Number(tid)] = arr.slice(0, 10).reduce((s, x) => s + x.ovr, 0) / Math.min(10, arr.length);
		}

		const pRows: any[] = [];
		const missing = new Set<string>();
		for (const p of players) {
			const statRows = p.stats.filter((s: any) => s.season === season && !s.playoffs && s.gp > 0);
			if (!statRows.length) continue;
			const ratingsRows = p.ratings.filter((r: any) => r.season === season);
			const rStart = ratingsRows[0];
			const rEnd = ratingsRows.at(-1);
			const prevRow = p.ratings.filter((r: any) => r.season === season - 1).at(-1);
			const injGames = p.injuries
				.filter((i: any) => i.season === season)
				.reduce((s: number, i: any) => s + i.games, 0);
			statRows.forEach((s: any, idx: number) => {
				const stats: any = {};
				for (const k of STAT_KEYS) {
					if (s[k] === undefined) missing.add(k);
					stats[k] = s[k] ?? null;
				}
				// BBGM stores only obpm/dbpm; bpm is derived here
				if (stats.bpm === null && s.obpm !== undefined && s.dbpm !== undefined) {
					stats.bpm = s.obpm + s.dbpm;
					missing.delete("bpm");
				}
				pRows.push({
					...base,
					season,
					pid: p.pid,
					tid: s.tid,
					tidEndOfSeason: p.tid,
					stint: idx,
					nStints: statRows.length,
					age: season - p.born.year,
					draftYear: p.draft.year,
					draftPick: p.draft.pick,
					hgtInches: p.hgt,
					weight: p.weight,
					ratings: pickRatings(rStart),
					ratingsEndOfSeason: rEnd !== rStart ? pickRatings(rEnd) : null,
					prevOvr: prevRow?.ovr ?? null,
					injury: {
						gamesMissedSeason: injGames,
						injuriesThisSeason: p.injuries.filter((i: any) => i.season === season).length,
						current: p.injury,
					},
					rosterOvrRank: p.tid === s.tid ? (rankOf[p.pid] ?? null) : null,
					contractAmount: p.contract.amount,
					stats,
				});
			});
		}
		write(files.players, pRows);
		const nRoster = await dumpRoster(season);

		const tRows: any[] = [];
		const lg: any = {};
		const sumKeys = ["gp", "min", "fg", "fga", "tp", "tpa", "ft", "fta", "orb", "drb", "ast", "tov", "stl", "blk", "ba", "pf", "pts", "fgAtRim", "fgaAtRim", "fgLowPost", "fgaLowPost", "fgMidRange", "fgaMidRange"];
		let possTot = 0;
		let minTot = 0;
		for (const ts of teamStats) {
			const tSeason = teamSeasons.find((x: any) => x.tid === ts.tid);
			const t = teamsArr.find((x: any) => x.tid === ts.tid);
			const ps = poss(ts);
			const pace = ts.min > 0 ? (gameLength * ps) / (ts.min / 5) : null;
			possTot += ps;
			minTot += ts.min;
			for (const k of sumKeys) lg[k] = (lg[k] ?? 0) + (ts[k] ?? 0);
			const { ownerMood, ...tsRest } = tSeason ?? ({} as any);
			tRows.push({
				...base,
				season,
				tid: ts.tid,
				abbrev: t?.abbrev,
				strategy: t?.strategy,
				won: tSeason?.won,
				lost: tSeason?.lost,
				poss: ps,
				pace,
				ortg: ps > 0 ? (100 * ts.pts) / ps : null,
				drtg: ps > 0 ? (100 * ts.oppPts) / ps : null,
				teamOvrTop10: teamOvrTop10[ts.tid] ?? null,
				totals: ts,
				teamSeason: { ...tsRest, ownerMood },
			});
		}
		write(files.teams, tRows);
		const nTeams = teamStats.length;
		write(files.league, [
			{
				...base,
				season,
				numTeams: nTeams,
				numGames,
				quarterLength: g.get("quarterLength"),
				numPeriods: g.get("numPeriods"),
				threePointers: g.get("threePointers"),
				gameLength,
				totals: lg,
				possPerTeamGame: possTot / (lg.gp || 1),
				pace: minTot > 0 ? (gameLength * possTot) / (minTot / 5) : null,
				ortg: possTot > 0 ? (100 * lg.pts) / possTot : null,
				ptsPerTeamGame: lg.pts / (lg.gp || 1),
				fgaPerTeamGame: lg.fga / (lg.gp || 1),
				tpaPerTeamGame: lg.tpa / (lg.gp || 1),
				ftaPerTeamGame: lg.fta / (lg.gp || 1),
				tpRate: lg.tpa / (lg.fga || 1),
				ftRate: lg.fta / (lg.fga || 1),
				missingPlayerStatFields: [...missing],
			},
		]);
		return { roster: nRoster, players: pRows.length, teams: tRows.length, missing: [...missing] };
	};

	// ---------- main loop ----------
	const start = g.get("season");
	for (let i = 0; i < SEASONS; i++) {
		const season = start + i;
		const ts = Date.now();
		if (g.get("phase") !== PHASE.PRESEASON || g.get("season") !== season) {
			throw new Error(`Expected preseason ${season}, got ${g.get("season")}/${g.get("phase")}`);
		}
		const nProg = i > 0 ? await recordProgs(season) : 0;
		const nRet = i > 0 ? await dumpRetired(season) : 0;
		await startAutoPlay(season, PHASE.PLAYOFFS, {});
		const tReg = Date.now();
		const res = await dumpSeason(season);
		await startAutoPlay(season + 1, PHASE.PRESEASON, {});
		const tEnd = Date.now();
		write(files.timing, [{ ...base, season, regSeasonSec: (tReg - ts) / 1000, totalSec: (tEnd - ts) / 1000 }]);
		const mem = Math.round(process.memoryUsage().heapUsed / 1e6);
		log(`season ${season} done in ${(tEnd - ts) / 1000}s players=${res.players} roster=${res.roster} retired=${nRet} teams=${res.teams} progs=${nProg} missing=${res.missing.join(",")} heapMB=${mem}`);
	}
	// progression into the season after the last one played
	const nProg = await recordProgs(g.get("season"));
	const nRetFinal = await dumpRetired(g.get("season"));
	log(`final retired ${nRetFinal}`);
	log(`final progs ${nProg}; total ${(Date.now() - t0) / 1000}s`);
	fs.writeFileSync(path.join(OUT, "DONE"), String(Date.now()));
});
