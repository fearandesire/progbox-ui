import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { describe, expect, it, vi } from "vitest";
import LabHistoryView from "./LabHistoryView.vue";

vi.mock("../lib/api", () => ({
  fetchLabRuns: vi.fn(async () => [
    { runId: "a", state: "done", mode: "deep", script: "net@4.3.0", baseline: "net@3.2.1", league: "nba-2025-26", verdict: "warn", seconds: 417, lab: { version: "0.3.0", checksVersion: 1 }, checks: { verdict: "worse", script: { passed: 2, applicable: 7 }, baseline: { passed: 6, applicable: 7 } } },
    { runId: "b", state: "done", mode: "quick", script: "net@4.4.0-draft.1", baseline: null, league: "nba-2025-26", verdict: "pass", seconds: 60, lab: { version: "0.3.0", checksVersion: 1 }, checks: { verdict: null, script: { passed: 3, applicable: 4 }, baseline: null } },
    { runId: "c", state: "done", mode: "quick", script: "net@3.2.1", baseline: null, league: null, verdict: "fail", seconds: 30, lab: null },
  ]),
  labErrorMessage: (_e: unknown, f: string) => f,
}));

describe("LabHistoryView", () => {
  it("shows the balance-check result as text, and the old verdict for older runs", async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/lab/history", component: LabHistoryView }, { path: "/:p(.*)*", component: { template: "<div />" } }] });
    await router.push("/lab/history");
    const wrapper = mount(LabHistoryView, { global: { plugins: [router] } });
    await flushPromises();
    const results = wrapper.findAll('[data-test="result"]');
    expect(results.map((r) => r.text())).toEqual(["Worse · 2/7", "3/4 checks", "fail"]);
    expect(results[0].classes()).toContain("bad");
    expect(results[0].attributes("title")).toBe("Balance checks passed: 2/7, vs 6/7 for net@3.2.1");
    expect(results[2].attributes("title")).toBe("Graded before balance checks existed");
  });
});
