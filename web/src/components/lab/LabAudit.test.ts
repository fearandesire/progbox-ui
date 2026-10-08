import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import LabAudit from "./LabAudit.vue";
import type { LabResults } from "../../lib/labTypes";
import { report, stubClipboard } from "../../test/labFixtures";

vi.mock("../../lib/api", () => ({
  labFileUrl: (runId: string, name: string) => `/api/lab/runs/${encodeURIComponent(runId)}/files/${encodeURIComponent(name)}`,
}));

const results = (over: Partial<LabResults> = {}): LabResults => ({
  report: report({ verdict: "Review flags" }),
  deep: null,
  manifest: { runId: "r1", seed: 42 },
  summary: null,
  players: { script: [], baseline: null },
  files: ["report.json", "manifest.json", "summary.md"],
  manifestPath: "runs/r1/manifest.json",
  replayCommand: "pnpm lab replay r1",
  ...over,
});

const mountAudit = (over: Partial<LabResults> = {}, runId = "r1") => mount(LabAudit, { props: { runId, results: results(over) } });

describe("LabAudit", () => {
  it("shows the replay command and the pretty-printed manifest and report", () => {
    const r = results();
    const w = mount(LabAudit, { props: { runId: "r1", results: r } });
    expect(w.text()).toContain("Reproduce this run");
    expect(w.find('[data-test="replay"]').text()).toBe("pnpm lab replay r1");
    const pres = w.findAll("pre");
    expect(pres).toHaveLength(2);
    expect(pres[0].text()).toBe(JSON.stringify(r.manifest, null, 2));
    expect(pres[0].text()).toContain('"seed": 42');
    expect(pres[1].text()).toBe(JSON.stringify(r.report, null, 2));
    expect(pres[1].text()).toContain('"verdict": "Review flags"');
  });

  it("lists each file as a download link to the run's file URL", () => {
    const w = mountAudit({ files: ["report.json", "my file.csv"] }, "run/1");
    const links = w.findAll("a[download]");
    expect(links.map((a) => a.text())).toEqual(["report.json", "my file.csv"]);
    expect(links.map((a) => a.attributes("href"))).toEqual([
      "/api/lab/runs/run%2F1/files/report.json",
      "/api/lab/runs/run%2F1/files/my%20file.csv",
    ]);
  });

  it("renders no file links when the run has no files", () => {
    const w = mountAudit({ files: [] });
    expect(w.findAll("a")).toHaveLength(0);
    expect(w.text()).toContain("Files");
  });

  it("shows null for a missing manifest and report", () => {
    const w = mountAudit({ manifest: null, report: null });
    expect(w.findAll("pre").map((p) => p.text())).toEqual(["null", "null"]);
  });

  it("starts with an empty status line", () => {
    const w = mountAudit();
    expect(w.find('[role="status"]').text()).toBe("");
  });

  it("copies the replay command and confirms it", async () => {
    const writeText = stubClipboard(true);
    const w = mountAudit();
    await w.find(".lab-cmd button").trigger("click");
    await flushPromises();
    expect(writeText).toHaveBeenCalledWith("pnpm lab replay r1");
    expect(w.find('[role="status"]').text()).toBe("Copied command");
  });

  it("copies manifest.json text", async () => {
    const writeText = stubClipboard(true);
    const r = results();
    const w = mount(LabAudit, { props: { runId: "r1", results: r } });
    await w.find('[data-test="copy-manifest"]').trigger("click");
    await flushPromises();
    expect(writeText).toHaveBeenCalledWith(JSON.stringify(r.manifest, null, 2));
    expect(w.find('[role="status"]').text()).toBe("Copied manifest.json");
  });

  it("copies report.json text", async () => {
    const writeText = stubClipboard(true);
    const r = results();
    const w = mount(LabAudit, { props: { runId: "r1", results: r } });
    const buttons = w.findAll(".panel-head button");
    expect(buttons).toHaveLength(2);
    await buttons[1].trigger("click");
    await flushPromises();
    expect(writeText).toHaveBeenCalledWith(JSON.stringify(r.report, null, 2));
    expect(w.find('[role="status"]').text()).toBe("Copied report.json");
  });

  it("says the copy was blocked when the clipboard rejects, then recovers", async () => {
    stubClipboard(false);
    const w = mountAudit();
    await w.find('[data-test="copy-manifest"]').trigger("click");
    await flushPromises();
    expect(w.find('[role="status"]').text()).toBe("Copy blocked by the browser");

    stubClipboard(true);
    await w.find('[data-test="copy-manifest"]').trigger("click");
    await flushPromises();
    expect(w.find('[role="status"]').text()).toBe("Copied manifest.json");
  });

  it("updates the pretty-printed JSON when results change", async () => {
    const w = mountAudit();
    await w.setProps({ results: results({ manifest: { seed: 7 } }) });
    expect(w.findAll("pre")[0].text()).toContain('"seed": 7');
  });
});
