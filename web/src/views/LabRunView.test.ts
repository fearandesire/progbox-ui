import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LabRunView from "./LabRunView.vue";

vi.mock("../lib/api", () => ({
  fetchLabRun: vi.fn(),
  labFileUrl: (id: string, name: string) => `/api/lab/runs/${id}/files/${name}`,
  labErrorMessage: (e: unknown, f: string) => (e instanceof Error ? e.message : f),
}));

import { fetchLabRun } from "../lib/api";

const value = (display: string, pass: boolean | null, pctFromStart: number | null = null) => ({ value: 0, display, pass, pctFromStart });

const CHECKS = {
  version: 1,
  rulesSha256: "3f2a91c0aabb",
  verdict: "worse",
  script: { passed: 1, applicable: 3 },
  baseline: { passed: 3, applicable: 3 },
  items: [
    { id: "league-ovr", name: "League average OVR holds", unit: "OVR change over 10 seasons", rule: "within 1.5 OVR of the start", applicable: true, script: value("−1.9", false, -3.7), baseline: value("−1.1", true, -2.2), noScript: { value: 0, display: "−4.9" }, change: { pct: 68, direction: "worse", note: "more decline" } },
    { id: "god-progs", name: "God progs stay rare", unit: "per offseason", rule: "1 or fewer", applicable: true, script: value("4.6", false), baseline: value("0.7", true), noScript: null, change: { pct: 570, direction: "worse", note: "6.7 times as many" } },
    { id: "aging", name: "Players age normally", unit: "mean OVR change", rule: "34+ at −2 or worse", applicable: true, script: value("+0.32 / −3.79", true), baseline: value("−0.35 / −3.64", true), noScript: null, change: { pct: 4, direction: "same", note: "both pass" } },
  ],
};

function runWith(report: Record<string, unknown>) {
  return {
    runId: "20261008000001",
    state: "done",
    mode: "deep",
    script: "net@4.3.0",
    baseline: "net@3.2.1",
    league: "nba-2025-26",
    startedAt: "2026-10-08T10:00:00Z",
    seconds: 417,
    results: {
      report: {
        verdict: "Hold",
        flags: [],
        mode: "deep",
        league: { id: "nba-2025-26", name: "Real NBA 2025-26", credit: null, issues: [], imputedRows: 0 },
        script: { id: "net@4.3.0", kpis: {}, apiCalls: {}, eventTypes: {}, errors: [] },
        baseline: { id: "net@3.2.1", kpis: {}, apiCalls: {}, errors: [] },
        deep: null,
        ...report,
      },
      deep: null,
      manifest: null,
      summary: null,
      players: { script: [], baseline: [] },
      files: [],
      manifestPath: "",
      replayCommand: "",
    },
  };
}

const stubs = { LabReport: true, LabPlayers: true, LabAudit: true, LabSummary: true };

async function mountView() {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/lab/runs/:id", component: LabRunView }, { path: "/lab", component: { template: "<div />" } }, { path: "/lab/scripts", component: { template: "<div />" } }, { path: "/lab/history", component: { template: "<div />" } }] });
  await router.push("/lab/runs/20261008000001");
  const wrapper = mount(LabRunView, { global: { plugins: [router], stubs } });
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

describe("LabRunView report", () => {
  it("leads with the verdict, pass/fail strips, checks and Run details", async () => {
    vi.mocked(fetchLabRun).mockResolvedValue(
      runWith({
        checks: CHECKS,
        runDetails: { mode: "deep", netRuns: "Every offseason, 10 seasons", gamesSimulated: true, statsRead: "2024-25 real, then 9 simulated seasons", league: { id: "nba-2025-26", name: "Real NBA 2025-26, Opening Night" }, runs: 200, seasons: 10, seed: 20261008, scripts: [{ id: "net@4.3.0", sha256: "c5959e65ff" }], pre: null },
        lab: { version: "0.3.0", commit: "54bc484", checks: { version: 1, rulesSha256: "3f2a91c0aabb" }, statgen: "statgen-2026-10-08" },
      }) as never,
    );
    const wrapper = await mountView();
    expect(wrapper.find(".page-desc").text()).toContain("Every offseason, 10 seasons · Real NBA 2025-26, Opening Night · 200 runs");
    expect(wrapper.find('[data-test="jump"]').text()).toBe("VerdictChecks3Run detailsChartsPlayersAudit");
    expect(wrapper.find('[data-test="verdict-title"]').text()).toBe("Worse than net@3.2.1");
    expect(wrapper.find('[data-test="verdict"]').text()).toContain("breaks 2 that net@3.2.1 passes");
    expect(wrapper.findAll('[data-test="strip-script"] a').map((a) => a.classes()[0])).toEqual(["fail", "fail", "pass"]);
    expect(wrapper.find('[data-test="moves"]').text()).toContain("Worse 2");
    expect(wrapper.find(".lab-pill").exists()).toBe(false);

    const first = wrapper.find('[data-check="league-ovr"]');
    expect(first.text()).toContain("−3.7%");
    expect(first.text()).toContain("+68% worse");
    expect(first.text()).toContain("−4.9");
    expect(wrapper.find('[data-test="checks"] thead').text()).toContain("Change vs 3.2.1");

    await wrapper.find('[data-filter="diff"]').trigger("click");
    expect(wrapper.findAll("[data-check]").map((r) => r.attributes("data-check"))).toEqual(["league-ovr", "god-progs"]);
    await wrapper.find('[data-test="strip-script"] a:last-child').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-check="aging"]').classes()).toContain("hit");

    const details = wrapper.find('[data-test="run-details"]').text();
    expect(details).toContain("0.3.0, commit 54bc484");
    expect(details).toContain("checks v1, rules 3f2a91c0…");
    expect(details).toContain("statgen-2026-10-08");
    expect(wrapper.find('[data-test="run-again"]').attributes("href")).toBe("/lab?script=net@4.3.0&baseline=net@3.2.1&league=nba-2025-26&mode=deep");
  });

  it("falls back to the old summary with a note for runs made before checks existed", async () => {
    vi.mocked(fetchLabRun).mockResolvedValue(runWith({}) as never);
    const wrapper = await mountView();
    expect(wrapper.find('[data-test="old-report"]').text()).toContain("before NET Lab 0.3.0");
    expect(wrapper.find('[data-test="verdict"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="jump"]').text()).toBe("SummaryChartsPlayersAudit");
  });
});
