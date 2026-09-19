import { describe, expect, it } from "vitest";
import { normalizeNetInput } from "./netInput.js";
const player = (pid: number, overrides = {}) => ({ pid, tid: 0, born: { year: 1995 }, draft: { year: 2015 }, ratings: [{ season: 2024, spd: 50 }], stats: [{ season: 2024, per: 20, gp: 82 }], ...overrides });
const league = (players: unknown[], phase: number = 1, season = 2024) => ({ gameAttributes: { season, phase }, players });
const normalize = (data: ReturnType<typeof league>, teams: string[] = [], version: "v4.3" | "v3.2.1" = "v4.3") => normalizeNetInput(data, { "0": "BOS", "1": "NYK" }, teams, version);
describe("NET input boundary", () => {
  it("uses prior regular-season stats and preserves the league pool when selecting a team", () => {
    const result = normalize(league([player(42), player(99, { tid: 1 }), player(100, { born: { year: 2000 } }), player(101, { stats: [{ season: 2024, per: -2 }] })]), ["BOS"]);
    expect(result.contract).toMatchObject({ entering_season: 2025, stats_season: 2024, target_count: 1, pool_count: 4 });
    expect(result.data.players.map(p => [p.pid, p._progbox_pool_only])).toEqual([[42, false], [99, true], [100, true], [101, true]]);
  });
  it("uses the last eligible stint for candidate and the old mean for Published", () => {
    const data = league([player(42, { stats: [{ season: 2023, per: 90 }, { season: 2024, per: 10 }, { season: 2024, per: 30 }, { season: 2024, per: 99, playoffs: true }] })]);
    expect(normalize(data).data.players[0]!.stats[0]!.per).toBe(30);
    expect(normalize(data, [], "v3.2.1").data.players[0]!.stats[0]!.per).toBe(20);
  });
  it("does not fall back from a final zero-PER stint in candidate", () => {
    const data = league([player(42, { stats: [{ season: 2024, per: 20 }, { season: 2024, per: 0 }] })]);
    expect(normalize(data).contract.pool_count).toBe(0);
    expect(normalize(data, [], "v3.2.1").data.players[0]!.stats[0]!.per).toBe(20);
  });
  it("takes preseason base ratings before the generated current row without mutating input", () => {
    const data = league([player(42, { ratings: [{ season: 2024, spd: 40 }, { season: 2025, spd: 90 }] })], 0, 2025);
    const before = JSON.stringify(data);
    expect(normalize(data).data.players[0]!.ratings[0]!.spd).toBe(40);
    expect(JSON.stringify(data)).toBe(before);
  });
  it("excludes retired, malformed, stale-season and rookie targets", () => {
    const result = normalize(league([player(1, { tid: -2 }), player(2, { born: null }), player(3, { ratings: [] }), player(4, { stats: [{ season: 2023, per: 30 }] }), player(5, { draft: { year: 2024 } }), player(6, { stats: [{ season: 2024, per: -4 }] })]));
    expect(result.contract).toMatchObject({ target_count: 0, pool_count: 2 });
    expect(normalize(league([player(6, { stats: [{ season: 2024, per: -4 }] })]), [], "v3.2.1").contract.target_count).toBe(1);
  });
  it("retains stable source IDs across differing version populations", () => {
    const data = league([player(91, { stats: [{ season: 2024, per: -4 }] }), player(27)]);
    expect(normalize(data).data.players.filter(p => !p._progbox_pool_only).map(p => p.pid)).toEqual([27]);
    expect(normalize(data, [], "v3.2.1").data.players.filter(p => !p._progbox_pool_only).map(p => p.pid)).toEqual([91, 27]);
  });
  it("keeps one-row preseason players in the pool but never progresses them", () => {
    const data = league([player(1, { ratings: [{ season: 2024, spd: 40 }, { season: 2025, spd: 60 }] }), player(2, { ratings: [{ season: 2025, spd: 50 }] }), player(3)], 0, 2025);
    const result = normalize(data);
    expect(result.contract).toMatchObject({ pool_count: 3, target_count: 1 });
    expect(result.data.players.map(p => [p.pid, p._progbox_pool_only])).toEqual([[1, false], [2, true], [3, true]]);
  });
  it("rejects invalid final candidate PER instead of using earlier stints", () => {
    for (const per of [null, undefined, Number.NaN]) {
      expect(normalize(league([player(42, { stats: [{ season: 2024, per: 20 }, { season: 2024, per }] })])).contract.pool_count).toBe(0);
    }
  });
  it("drops a cancelling Published mean and preserves original indices", () => {
    expect(normalize(league([player(42, { stats: [{ season: 2024, per: 10 }, { season: 2024, per: -10 }] })]), [], "v3.2.1").contract.pool_count).toBe(0);
    expect(normalize(league([null, player(1, { pid: undefined })])).data.players[0]!.pid).toBe(1);
  });
  it("rejects missing seasons and assigns unique fallback source indices", () => {
    expect(() => normalizeNetInput({ players: [] }, {}, [], "v4.3")).toThrow("explicit integer");
    expect(normalize(league([player(1), player(1)])).data.players.map(p => p.pid)).toEqual([0, 1]);
  });
});
