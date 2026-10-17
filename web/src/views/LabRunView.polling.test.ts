import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LabRunView from "./LabRunView.vue";
import { report } from "../test/labFixtures";
import type { LabCheckItem, LabChecks, LabRunDetail } from "../lib/labTypes";

vi.mock("../lib/api", () => ({
  fetchLabRun: vi.fn(),
  labFileUrl: (id: string, name: string) => `/api/lab/runs/${id}/files/${name}`,
  labErrorMessage: (e: unknown, f: string) => (e instanceof Error ? e.message : f),
}));

import { fetchLabRun } from "../lib/api";

const stubs = { LabReport: true, LabPlayers: true, LabAudit: true, LabSummary: { props: ["report", "summary"], template: `<div data-test="summary">{{ report.verdict }}</div>` } };

function base(over: Partial<LabRunDetail> = {}): LabRunDetail {
  return { runId: "r1", state: "queued", mode: "deep", script: "net@4.3.0", baseline: "net@3.2.1", league: null, createdAt: "2026-10-08T09:59:00Z", results: null, ...over };
}

function done(checks: LabChecks | null): LabRunDetail {
  return base({
    state: "done",
    startedAt: "2026-10-08T10:00:00Z",
    seconds: 417,
    results: {
      report: report({ checks }),
      deep: null,
      manifest: null,
      summary: null,
      players: { script: [], baseline: null },
      files: [],
      manifestPath: "",
      replayCommand: "",
    },
  });
}

let router: Router;
async function mountAt(path: string, attach = false) {
  router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/lab/runs/:id", component: LabRunView }, { path: "/lab", component: { template: "<div />" } }, { path: "/lab/scripts", component: { template: "<div />" } }, { path: "/lab/history", component: { template: "<div />" } }] });
  await router.push(path);
  const wrapper = mount(LabRunView, { global: { plugins: [router], stubs }, attachTo: attach ? document.body : undefined });
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(new Date("2026-10-08T10:01:00Z"));
  // jsdom does not implement scrollIntoView, so spyOn needs a base method to wrap.
  Element.prototype.scrollIntoView ??= () => {};
  vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
});

describe("LabRunView live progress", () => {
  it("polls a queued run through running to done, then stops", async () => {
    vi.mocked(fetchLabRun)
      .mockResolvedValueOnce(base({ state: "queued", position: 2 }))
      .mockResolvedValueOnce(
        base({
          state: "running",
          startedAt: "2026-10-08T10:00:00Z",
          elapsed: 30,
          estimateSeconds: 240,
          estimateBasis: ["deep x 200"],
          stage: "quick:net@3.2.1",
          stages: [{ stage: "quick:net@4.3.0", text: "Script offseasons", done: 1000, total: 1000 }],
          progress: { stage: "quick:net@3.2.1", done: 250, total: 1000 },
          issues: [{ level: "warn", code: "slow", text: "Machine is busy" }],
        }),
      )
      .mockResolvedValue(done(null));

    const w = await mountAt("/lab/runs/r1");
    const progress = () => w.find('[data-test="progress"]');
    expect(progress().text()).toContain("Queued");
    expect(progress().text()).toContain("number 2 in line");
    expect(w.find('[data-test="run-again"]').exists()).toBe(false);

    await vi.advanceTimersByTimeAsync(1000);
    expect(progress().text()).toContain("Running");
    expect(progress().text()).toContain("1m 01s of ~4m 00s estimated");
    const stages = w.findAll(".lab-stage");
    expect(stages.map((s) => s.classes().find((c) => c !== "lab-stage"))).toEqual(["done", "done", "current", "pending", "pending", "pending"]);
    expect(stages[1]!.text()).toContain("Script offseasons");
    expect(stages[2]!.text()).toContain("250 / 1000");
    expect(stages[2]!.find(".lab-bar").exists()).toBe(true);
    expect(w.find(".lab-issues").text()).toContain("Machine is busy");

    await vi.advanceTimersByTimeAsync(1000);
    expect(progress().exists()).toBe(false);
    expect(w.find('[data-test="summary"]').exists()).toBe(true);
    expect(w.find(".page-desc").text()).toContain("6m 57s");
    expect(fetchLabRun).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchLabRun).toHaveBeenCalledTimes(3);
  });

  it("moves a queued submission's URL to its real run id once it starts", async () => {
    vi.mocked(fetchLabRun).mockImplementation(async (id: string) => (id === "q-77" ? base({ runId: "r1", state: "running" }) : done(null)));
    await mountAt("/lab/runs/q-77");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/lab/runs/r1");
    expect(vi.mocked(fetchLabRun).mock.calls.map((c) => c[0])).toEqual(["q-77", "r1"]);
  });

  it("keeps retrying through a transient fetch error while the run is live", async () => {
    vi.mocked(fetchLabRun)
      .mockResolvedValueOnce(base({ state: "running", startedAt: "2026-10-08T10:00:00Z", estimateSeconds: 100 }))
      .mockRejectedValueOnce(new Error("API restarting"))
      .mockResolvedValueOnce(done(null));
    const w = await mountAt("/lab/runs/r1");

    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchLabRun).toHaveBeenCalledTimes(2);
    expect(w.find('[data-test="progress"]').exists()).toBe(true);
    expect(w.find('[role="alert"]').exists()).toBe(false);

    await vi.advanceTimersByTimeAsync(2999);
    expect(fetchLabRun).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchLabRun).toHaveBeenCalledTimes(3);
    expect(w.find('[data-test="summary"]').exists()).toBe(true);
  });

  it("shows the error and stops when the first load fails", async () => {
    vi.mocked(fetchLabRun).mockRejectedValue(new Error("No such run"));
    const w = await mountAt("/lab/runs/nope");
    expect(w.find('[role="alert"]').text()).toBe("No such run");
    await vi.advanceTimersByTimeAsync(10000);
    expect(fetchLabRun).toHaveBeenCalledTimes(1);
  });

  it("stops polling when the page is left", async () => {
    vi.mocked(fetchLabRun).mockResolvedValue(base({ state: "running" }));
    const w = await mountAt("/lab/runs/r1");
    w.unmount();
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchLabRun).toHaveBeenCalledTimes(1);
  });
});

describe("LabRunView finished states", () => {
  it("shows a failed run's error, or a default when none was recorded", async () => {
    vi.mocked(fetchLabRun).mockResolvedValueOnce(base({ state: "failed", error: "Script threw at line 4" }));
    let w = await mountAt("/lab/runs/r1");
    expect(w.find('[data-test="run-error"]').text()).toBe("Script threw at line 4");
    expect(w.find('[data-test="run-again"]').attributes("href")).toBe("/lab?script=net@4.3.0&baseline=net@3.2.1&mode=deep");

    vi.mocked(fetchLabRun).mockResolvedValueOnce(base({ state: "failed", baseline: null }));
    w = await mountAt("/lab/runs/r1");
    expect(w.find('[data-test="run-error"]').text()).toBe("No error message was recorded.");
    expect(w.find("h1").text()).toBe("net@4.3.0");
    expect(w.find('[data-test="run-again"]').attributes("href")).toContain("baseline=none");
  });

  it("says when a finished run's report files are missing", async () => {
    vi.mocked(fetchLabRun).mockResolvedValueOnce(base({ state: "done", runId: null }));
    const w = await mountAt("/lab/runs/r1");
    expect(w.text()).toContain("report files are missing");
    expect(w.find(".page-desc").text()).toContain("Every offseason, 10 seasons · default league");
  });

  it("shows the old summary for a run without report.checks", async () => {
    vi.mocked(fetchLabRun).mockResolvedValueOnce(done(null));
    const w = await mountAt("/lab/runs/r1", true);
    expect(w.find('[data-test="old-report"]').exists()).toBe(true);
    expect(w.find('[data-test="summary"]').text()).toBe("Review flags");
    expect(w.find('[data-test="checks"]').exists()).toBe(false);
    expect(w.find('a[download="report.json"]').attributes("href")).toBe("/api/lab/runs/r1/files/report.json");

    await w.findAll('[data-test="jump"] a')[1]!.trigger("click");
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: "start" });
    w.unmount();
  });

  it("shows checks for a new run, with n/a and the reason when the script has no value", async () => {
    const naItem: LabCheckItem = {
      id: "production", name: "Production matters", unit: "ΔOVR per SD of PER", rule: "0.2 or more", applicable: true, basis: "file-stats",
      script: null, baseline: { value: 0.4, display: "0.40", pass: true, pctFromStart: null }, missing: "The script progressed nobody", noScript: null, change: null,
    };
    const checks: LabChecks = {
      version: 2, rulesSha256: "3f2a91c0aabb", verdict: null,
      script: { passed: 0, applicable: 0 }, baseline: { passed: 1, applicable: 1 },
      items: [naItem],
    };
    vi.mocked(fetchLabRun).mockResolvedValueOnce(done(checks));
    const w = await mountAt("/lab/runs/r1");
    expect(w.find('[data-test="summary"]').exists()).toBe(false);
    expect(w.find('[data-test="jump"]').text()).toBe("VerdictChecks1ChartsPlayersAudit");
    const row = w.find('[data-check="production"]');
    const cells = row.findAll("td");
    expect(cells[1]!.text()).toBe("n/a");
    expect(cells[1]!.find("span").attributes("title")).toBe("The script progressed nobody");
    expect(cells[2]!.text()).toContain("0.40");
    expect(row.text()).toContain("The script progressed nobody");
  });
});
