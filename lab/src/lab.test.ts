import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyze, ols } from "./analyze.ts";
import { flagsFor } from "./report.ts";
import { compatRandom, limitRating, ovr, RATING_KEYS } from "./compat.ts";
import { boundaryFrom } from "./league.ts";
import { declaredVersion, Registry } from "./registry.ts";
import { NET_STAT_FIELDS, validateLeague } from "./validate.ts";
import { loadModel, runReplicate } from "./deep.ts";
import { imputeStats, simulateSeason } from "./statgen/model.ts";
import { createRng, seededMath } from "./rng.ts";
import { runScript } from "./runScript.ts";
import { createBbgm, PHASE, type Player } from "./shim.ts";
import { packPlayers, runOnce, type Job } from "./simulate.ts";

const script = (name: string) => ({ name, source: fs.readFileSync(path.join(import.meta.dirname, "../scripts", `${name}.js`), "utf8") });

/** A small regular-season league: 30 veterans with varied production, plus one 22-year-old. */
function league(): Player[] {
  const players: Player[] = [];
  for (let i = 0; i < 31; i++) {
    const young = i === 30;
    const base: Record<string, number> = Object.fromEntries(RATING_KEYS.map((k, n) => [k, 40 + ((i * 7 + n * 3) % 30)]));
    base.ovr = ovr(base);
    players.push({
      pid: i,
      firstName: "Fixture",
      lastName: String(i),
      tid: i % 5,
      born: { year: young ? 1994 : 1986 + (i % 5) },
      draft: { year: 2008 },
      watch: 0,
      ratings: [
        { ...base, season: 2015 },
        { ...base, season: 2016 },
      ],
      stats: [
        { season: 2016, playoffs: false, gp: 70, min: 1800, minAvailable: 3400, per: 8 + (i % 12), obpm: (i % 7) - 3, dbpm: (i % 5) - 2, stlp: 1.5, blkp: 1, usgp: 18, ortg: 105, fga: 700, fta: 200, tov: 100 },
      ],
    });
  }
  return players;
}

function job(name: string): Job {
  const players = league();
  const { players: _, ...meta } = boundaryFrom({ data: { gameAttributes: { season: 2016, phase: PHASE.REGULAR_SEASON }, players }, sha256: "fixture" });
  return { meta, playersBuf: packPlayers(players), pre: script("worker-console"), script: script(name) };
}

describe("bbgm shim", () => {
  it("names the exact API a script needs when the shim lacks it", async () => {
    const math = seededMath(createRng(1));
    const { bbgm } = createBbgm({ players: [], season: 2017, phase: PHASE.PRESEASON, math });
    const out = await runScript("await bbgm.team.get(0);", { bbgm, math, filename: "gap.js" });
    expect(out.error?.message).toBe("bbgm.team is not supported by NET Lab yet");
  });

  it("serves g.get from the export's attributes and rejects unknown keys", async () => {
    const math = seededMath(createRng(1));
    const { bbgm } = createBbgm({ players: [], season: 2017, phase: 0, math, gameAttributes: { numGames: [{ start: null, value: 82 }] } });
    const ok = await runScript("console.log(bbgm.g.get('numGames'), bbgm.g.get('season'));", { bbgm, math, filename: "g.js" });
    expect(ok.console).toEqual(["82 2017"]);
    const bad = await runScript("bbgm.g.get('salaryCap');", { bbgm, math, filename: "g.js" });
    expect(bad.error?.message).toContain('g.get("salaryCap")');
  });
});

describe("one offseason", () => {
  for (const name of ["net-4.3.0", "net-3.2.1"]) {
    it(`${name}: same seed replays exactly, a new seed differs`, async () => {
      const j = job(name);
      const a = await runOnce(j, 0, 123);
      const b = await runOnce(j, 0, 123);
      const c = await runOnce(j, 0, 456);
      expect(a.error).toBeUndefined();
      expect(a.outcomes.length).toBeGreaterThan(0);
      expect(b.outcomes).toEqual(a.outcomes);
      expect(c.outcomes).not.toEqual(a.outcomes);
    });
  }

  it("progresses only watched veterans and keeps integer ratings", async () => {
    const r = await runOnce(job("net-4.3.0"), 0, 7);
    const pids = r.outcomes.map((o) => o.pid);
    expect(pids).not.toContain(30);
    expect(pids.length).toBe(30);
    expect(r.outcomes.flatMap((o) => o.ratings).filter((v) => !(Number.isInteger(v) && v >= 0 && v <= 100))).toEqual([]);
  });
});

describe("health checks", () => {
  it("flags ratings a script leaves as NaN or out of range", async () => {
    const j = job("net-4.3.0");
    j.script = { name: "broken.js", source: "for (const p of await bbgm.idb.cache.players.getAll()) { if (p.watch === 1) { bbgm.player.addRatingsRow(p); p.ratings.at(-1).spd = NaN; await bbgm.idb.cache.players.put(p); } }" };
    const boundary = boundaryFrom({ data: { gameAttributes: { season: 2016, phase: PHASE.REGULAR_SEASON }, players: league() }, sha256: "fixture" });
    const a = analyze(boundary, [await runOnce(j, 0, 1)]);
    expect(a.kpis.invalidRows).toBe(30);
    expect(flagsFor(a)[0]).toMatchObject({ level: "error" });
  });
});

describe("ols", () => {
  it("recovers known coefficients", () => {
    const X = Array.from({ length: 50 }, (_, i) => [1, i, (i * 7) % 11]);
    const y = X.map(([, a, b]) => 2 + 0.5 * a! - 3 * b!);
    const beta = ols(X, y)!;
    expect(beta[0]).toBeCloseTo(2);
    expect(beta[1]).toBeCloseTo(0.5);
    expect(beta[2]).toBeCloseTo(-3);
  });
});

describe("compat helpers match recorded BBGM outputs", () => {
  const golden = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "fixtures/compat-golden.json"), "utf8"));
  it("ovr", () => {
    for (const [values, expected] of golden.ovr) expect(ovr(Object.fromEntries(golden.ratingKeys.map((k: string, i: number) => [k, values[i]])))).toBe(expected);
  });
  it("limitRating", () => {
    for (const [x, expected] of golden.limitRating) expect(limitRating(x)).toBe(expected);
  });
  it("seeded random", () => {
    const random = compatRandom(Math);
    for (const [seed, u, r] of golden.uniformSeed_randInt) {
      expect(random.uniformSeed(seed)).toBe(u);
      expect(random.randInt(0, 10, seed)).toBe(r);
    }
    for (const [seed, expected] of golden.shuffle) {
      const list = Array.from({ length: 12 }, (_, i) => i);
      random.shuffle(list, seed);
      expect(list).toEqual(expected);
    }
  });
});

describe("script registry", () => {
  const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), "lab-reg-"));
  it("forces a version and never reuses an id for different code", () => {
    const reg = new Registry(dir());
    const a = reg.add("/** NET | v4.4.0 */\nlet x = 1;");
    expect(a.entry.id).toBe("net@4.4.0-draft.1");
    expect(reg.add("/** NET | v4.4.0 */\nlet x = 1;").created).toBe(false);
    const c = reg.add("let y = 3;");
    expect(c.entry.id).toBe("net@4.4.0-draft.2");
    const pub = reg.add("/** NET | v3.2.1 */", { role: "published" });
    expect(pub.entry.id).toBe("net@3.2.1");
  });
  it("forces the version up when the header's version holds other code, keeping the upload", () => {
    const reg = new Registry(dir());
    reg.add("/** NET | v4.3.0 */\nlet x = 1;", { role: "candidate" });
    const b = reg.add("/** NET | v4.3.0 */\nlet x = 2;");
    expect(b.entry.id).toBe("net@4.3.1-draft.1");
    expect(b.entry.bumped).toMatchObject({ from: "4.3.0", to: "4.3.1" });
    expect(b.notes.join(" ")).toContain("Version forced up");
    expect(reg.read(b.entry)).toBe("/** NET | v4.3.1 */\nlet x = 2;");
    expect(fs.readFileSync(path.join(reg.dir, b.entry.bumped!.originalFile), "utf8")).toBe("/** NET | v4.3.0 */\nlet x = 2;");
    // Re-uploading the original resolves to the bumped entry; another clash goes one higher.
    expect(reg.add("/** NET | v4.3.0 */\nlet x = 2;").entry.id).toBe("net@4.3.1-draft.1");
    expect(reg.add("/** NET | v4.3.0 */\nlet x = 3;").entry.id).toBe("net@4.3.2-draft.1");
  });
  it("deletes drafts to a 7-day trash, restores them, and purges them later", () => {
    const root = dir();
    const runsDir = path.join(root, "runs");
    let now = new Date("2026-10-08T00:00:00Z");
    const reg = new Registry(path.join(root, "scripts"), { trashDir: path.join(root, "trash"), runsDir, now: () => now });
    const draft = reg.add("/** NET | v4.4.0 */\nlet x = 1;").entry;
    const other = reg.add("/** NET | v4.4.0 */\nlet x = 2;").entry;
    for (const [runId, script] of [["20261008000001", draft.id], ["20261008000002", other.id]]) {
      fs.mkdirSync(path.join(runsDir, runId!), { recursive: true });
      fs.writeFileSync(path.join(runsDir, runId!, "status.json"), JSON.stringify({ script }));
    }
    expect(reg.runsOf(draft.id)).toEqual(["20261008000001"]);

    const del = reg.delete(draft.id, { runs: true });
    expect(del).toEqual({ id: draft.id, trashedUntil: "2026-10-15T00:00:00.000Z", runs: ["20261008000001"] });
    expect(reg.get(draft.id)).toBeUndefined();
    expect(fs.existsSync(path.join(reg.dir, draft.file))).toBe(false);
    expect(fs.existsSync(path.join(runsDir, "20261008000001"))).toBe(false);
    expect(fs.existsSync(path.join(runsDir, "20261008000002"))).toBe(true);

    const back = reg.restore(draft.id);
    expect(back.entry.id).toBe(draft.id);
    expect(back.runs).toEqual(["20261008000001"]);
    expect(reg.read(back.entry)).toBe("/** NET | v4.4.0 */\nlet x = 1;");
    expect(fs.existsSync(path.join(runsDir, "20261008000001", "status.json"))).toBe(true);

    reg.delete(draft.id);
    now = new Date("2026-10-14T23:00:00Z");
    expect(reg.purge()).toEqual([]);
    now = new Date("2026-10-15T00:00:01Z");
    expect(reg.purge()).toEqual([draft.id]);
    expect(() => reg.restore(draft.id)).toThrow(/purged/);
    // The id is never given to other code; the same code gets it back.
    expect(reg.add("let y = 9;").entry.id).not.toBe(draft.id);
    const again = reg.add("/** NET | v4.4.0 */\nlet x = 1;");
    expect(again.entry.id).toBe(draft.id);
    expect(again.notes[0]).toContain("gets that id back");
    expect(reg.read(again.entry)).toBe("/** NET | v4.4.0 */\nlet x = 1;");
  });
  it("brings a trashed draft back when the same code is uploaded again", () => {
    const reg = new Registry(dir());
    const draft = reg.add("let a = 1;").entry;
    reg.delete(draft.id);
    const re = reg.add("let a = 1;");
    expect(re.entry.id).toBe(draft.id);
    expect(reg.trashed()).toEqual([]);
  });
  it("locks candidate, published and built-in scripts", () => {
    const reg = new Registry(dir());
    const cand = reg.add("/** NET | v4.3.0 */", { role: "candidate" }).entry;
    const builtin = reg.add("/** hook */", { family: "hook", role: "published", version: "1.0.0", source: "builtin:worker-console" }).entry;
    expect(() => reg.delete(cand.id)).toThrow(expect.objectContaining({ status: 409, message: expect.stringContaining("next release") }));
    expect(() => reg.delete(builtin.id)).toThrow(expect.objectContaining({ status: 409 }));
    expect(() => reg.delete("net@9.9.9")).toThrow(expect.objectContaining({ status: 404 }));
    expect(reg.get(cand.id)).toBeDefined();
  });
  it("exports the stored file and the original upload of a bumped version", () => {
    const reg = new Registry(dir());
    reg.add("/** NET | v4.3.0 */\nlet x = 1;", { role: "candidate" });
    const b = reg.add("/** NET | v4.3.0 */\nlet x = 2;").entry;
    expect(reg.exportSource(b.id)).toEqual({ filename: "net@4.3.1-draft.1.js", text: "/** NET | v4.3.1 */\nlet x = 2;" });
    expect(reg.exportSource(b.id, true)).toEqual({ filename: "net@4.3.1-draft.1.original.js", text: "/** NET | v4.3.0 */\nlet x = 2;" });
    expect(() => reg.exportSource("net@4.3.0", true)).toThrow(expect.objectContaining({ status: 404 }));
    // Deleting a bumped draft trashes its original too, and restoring brings both back.
    reg.delete(b.id);
    reg.restore(b.id);
    expect(reg.exportSource(b.id, true).text).toBe("/** NET | v4.3.0 */\nlet x = 2;");
  });
  it("reads declared versions from headers", () => {
    expect(declaredVersion("/**\n * NoEyeTest: BBGM Prog Script | v4.3.0 (opt-in release)")).toBe("4.3.0");
    expect(declaredVersion("// version 4.4")).toBe("4.4.0");
    expect(declaredVersion("const a = 1;")).toBeNull();
  });
});

describe("league validation", () => {
  const exportFor = (patch: (d: any) => void = () => {}) => {
    const players = Array.from({ length: 30 * 14 }, (_, i) => ({
      tid: i % 30,
      born: { year: 1995 },
      ratings: [{ season: 2025, ...Object.fromEntries(RATING_KEYS.map((k) => [k, 50])) }],
      stats: [{ season: 2025, playoffs: false, gp: 60, min: 1500, per: 15, ...Object.fromEntries(NET_STAT_FIELDS.filter((f) => !["gp", "min", "per"].includes(f)).map((f) => [f, 1])) }],
    }));
    const d: any = { startingSeason: 2026, gameAttributes: { phase: 0 }, players, teams: Array.from({ length: 30 }, (_, tid) => ({ tid, abbrev: `T${tid}` })) };
    patch(d);
    return d;
  };
  it("fixes what BBGM would fix on import", () => {
    const d = exportFor();
    const v = validateLeague(d);
    expect(v.ok).toBe(true);
    expect(v.season).toBe(2026);
    expect(d.players[5].pid).toBe(5);
    expect(d.players[0].ratings[0].ovr).toBeTypeOf("number");
    expect(v.issues.map((i) => i.code)).toEqual(expect.arrayContaining(["season-from-startingSeason", "assigned-pids", "computed-ovr"]));
  });
  it("marks missing shot zones for imputation and blocks missing core stats", () => {
    const v = validateLeague(exportFor((d) => d.players.forEach((p: any) => { delete p.stats[0].fgaAtRim; delete p.stats[0].minAvailable; })));
    expect(v.ok).toBe(true);
    expect(v.imputed).toEqual(["minAvailable", "fgaAtRim"]);
    const bad = validateLeague(exportFor((d) => d.players.forEach((p: any) => delete p.stats[0].obpm)));
    expect(bad.ok).toBe(false);
    expect(bad.issues.find((i) => i.level === "error")?.code).toBe("missing-stat");
  });
  it("blocks tiny leagues", () => {
    const v = validateLeague(exportFor((d) => { d.players = d.players.slice(0, 40); d.teams = d.teams.slice(0, 1); }));
    expect(v.issues.filter((i) => i.level === "error").map((i) => i.code)).toEqual(expect.arrayContaining(["few-teams", "small-stat-pool"]));
  });
});

describe("StatGen", () => {
  const model = loadModel();
  it("passed its calibration gate", () => {
    expect((model.calibration as { pass: boolean }).pass).toBe(true);
  });
  it("plays a season with every field NET reads, consistent with BBGM's identities", () => {
    const players = league();
    simulateSeason(model, players, 2017, createRng(3));
    const rows = players.flatMap((p) => p.stats.filter((s: any) => s.season === 2017));
    expect(rows.length).toBeGreaterThan(20);
    for (const s of rows) {
      for (const f of NET_STAT_FIELDS) expect(Number.isFinite(s[f]), f).toBe(true);
      expect(s.fga).toBe(s.fgaAtRim + s.fgaLowPost + s.fgaMidRange + s.tpa);
      expect(s.fgAtRim).toBeLessThanOrEqual(s.fgaAtRim);
      expect(s.min).toBeLessThanOrEqual(s.minAvailable);
    }
  });
  it("imputes shot zones that add up to the real 2-point totals", () => {
    const players = league();
    simulateSeason(model, players, 2017, createRng(4));
    for (const p of players) for (const s of p.stats) { delete s.fgaAtRim; delete s.fgAtRim; delete s.fgaLowPost; delete s.fgLowPost; delete s.fgaMidRange; delete s.fgMidRange; }
    const n = imputeStats(model, players, 2017, ["fgaAtRim", "fgAtRim", "fgaLowPost", "fgLowPost", "fgaMidRange", "fgMidRange"]);
    expect(n).toBeGreaterThan(0);
    for (const p of players) for (const s of p.stats.filter((x: any) => x.season === 2017 && x.gp > 0)) {
      expect(s.fgaAtRim + s.fgaLowPost + s.fgaMidRange).toBe(Math.max(0, s.fga - s.tpa));
      expect(s.fgAtRim + s.fgLowPost + s.fgMidRange).toBeLessThanOrEqual(s.fg - s.tp + 3);
    }
  });
  it("runs a deterministic multi-season replicate", async () => {
    const players = league();
    const b = boundaryFrom({ data: { players, gameAttributes: { season: 2016, phase: PHASE.REGULAR_SEASON } }, sha256: "x" });
    const { players: ps, ...meta } = b;
    const djob = { meta, playersBuf: packPlayers(ps), pre: script("worker-console"), script: script("net-4.3.0"), seasons: 3, modelFile: path.join(import.meta.dirname, "../models/statgen.json") };
    const a = await runReplicate(djob, 0, 7);
    const again = await runReplicate(djob, 0, 7);
    expect(a.error).toBeUndefined();
    expect(a.seasons.map((s) => s.season)).toEqual([2017, 2018, 2019]);
    expect(a.seasons[1]!.drafted).toBeGreaterThan(0);
    expect(JSON.stringify(again.seasons)).toBe(JSON.stringify(a.seasons));
  });
});

describe("after one season", () => {
  const modelFile = path.join(import.meta.dirname, "../models/statgen.json");
  const djob = (phase: number) => {
    const b = boundaryFrom({ data: { players: league(), gameAttributes: { season: 2016, phase } }, sha256: "x" });
    const { players: ps, ...meta } = b;
    return { meta, playersBuf: packPlayers(ps), pre: script("worker-console"), script: script("net-4.3.0"), seasons: 1, modelFile, playFirst: true };
  };
  it("plays the season first, then runs NET once at the next preseason", async () => {
    // Preseason file: plays 2016, NET runs entering 2017.
    const pre = await runReplicate(djob(PHASE.PRESEASON), 0, 7);
    expect(pre.error).toBeUndefined();
    expect(pre.seasons.map((s) => s.season)).toEqual([2017]);
    expect(pre.seasons[0]!.progressed).toBeGreaterThan(0);
    // Mid-season file: plays out 2016 itself, NET runs entering 2017 on the simulated stats.
    const mid = await runReplicate(djob(PHASE.REGULAR_SEASON), 0, 7);
    const now = await runReplicate({ ...djob(PHASE.REGULAR_SEASON), playFirst: false }, 0, 7);
    expect(mid.seasons.map((s) => s.season)).toEqual([2017]);
    expect(mid.seasons[0]!.sumDelta).not.toBe(now.seasons[0]!.sumDelta);
  });
});

describe("presets", () => {
  it("match the copy the web app shows", async () => {
    const { PRESETS } = await import("./presets.ts");
    const { DEFAULT_LEAGUE } = await import("./leagues.ts");
    const web = fs.readFileSync(path.join(import.meta.dirname, "../../web/src/lib/labFormat.ts"), "utf8");
    expect(web).toContain(`quick: { runs: ${PRESETS.quick.runs} }`);
    expect(web).toContain(`deep: { seasons: ${PRESETS.deep.seasons}, replicates: ${PRESETS.deep.replicates} }`);
    expect(web).toContain(`DEFAULT_LEAGUE_ID = "${DEFAULT_LEAGUE}"`);
  });
});
