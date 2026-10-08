import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import LabPlayers from "./LabPlayers.vue";
import type { LabPlayer } from "../../lib/labTypes";

vi.mock("./LabChart.vue", () => ({
  default: { name: "LabChart", props: { series: Array, labels: Array, statgen: Boolean }, template: `<div data-test="chart" :data-statgen="statgen ? 'yes' : 'no'">{{ JSON.stringify(series) }}</div>` },
}));

const player = (pid: number, name: string, meanDelta: number, attr: Record<string, number> = {}): LabPlayer => ({
  pid, name, tid: 1, age: 25, per: 15, bpm: 1, baseOvr: 50, runs: 10, meanOvr: 50 + meanDelta, meanDelta, sdDelta: 1,
  min: -2, q10: -1, median: 1, q90: 3, max: 5, pctPositive: 0.5, godRate: 0.1, attrDelta: { hgt: 0, spd: 1, ...attr },
});

const props = {
  scriptId: "net@4.4.0-draft.1",
  baselineId: "net@3.2.1",
  players: { script: [player(1, "Ann Able", 2), player(2, "Bo Baker", -1), player(3, "Cy Carr", 0.5)], baseline: [player(1, "Ann Able", 1, { spd: 0.25 }), player(2, "Bo Baker", -2)] },
  deep: {
    script: { replicates: 4, failed: 0, ageCurve: {}, seasons: [{ season: 2026 }, { season: 2027 }] as never, trajectories: [{ pid: 1, ovr: [{ mean: 52, p10: 50, p90: 54, active: 1 }, { mean: 53, p10: 50, p90: 56, active: 1 }] }] },
    baseline: { replicates: 4, failed: 0, ageCurve: {}, seasons: [] as never, trajectories: [{ pid: 1, ovr: [{ mean: 51, p10: 50, p90: 52, active: 1 }, { mean: 51.5, p10: 50, p90: 53, active: 1 }] }] },
  },
};

const names = (w: ReturnType<typeof mount>) => w.findAll("tbody tr").map((r) => r.find("td").text());

describe("LabPlayers", () => {
  it("sorts, searches and shows rating deltas plus the deep OVR trajectory", async () => {
    const w = mount(LabPlayers, { props });
    expect(names(w)).toEqual(["Ann Able", "Cy Carr", "Bo Baker"]);
    expect(w.find("thead").text()).toContain("net@3.2.1 Δ");

    await w.findAll("thead th")[0]!.trigger("click");
    expect(names(w)).toEqual(["Ann Able", "Bo Baker", "Cy Carr"]);

    await w.find('[data-test="player-search"]').setValue("bo");
    expect(names(w)).toEqual(["Bo Baker"]);
    expect(w.find('[data-test="player-count"]').text()).toBe("1 of 3 players");
    await w.find('[data-test="player-search"]').setValue("");

    await w.findAll("tbody tr")[0]!.trigger("click");
    const charts = w.findAll('[data-test="chart"]');
    expect(charts).toHaveLength(2);
    const ratings = JSON.parse(charts[0]!.text());
    expect(ratings.map((s: { role: string }) => s.role)).toEqual(["baseline", "script"]);
    expect(ratings[0].data[2]).toBe(0.25);
    const trajectory = JSON.parse(charts[1]!.text());
    expect(trajectory[1].data).toEqual([50, 52, 53]);
    expect(charts[1]!.attributes("data-statgen")).toBe("yes");
  });
});
