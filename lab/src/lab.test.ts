import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyze, ols } from "./analyze.ts";
import { flagsFor } from "./report.ts";
import { bbgmHelpers, RATING_KEYS } from "./bbgmHelpers.ts";
import { boundaryFrom } from "./league.ts";
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
    base.ovr = bbgmHelpers().ovr(base);
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
