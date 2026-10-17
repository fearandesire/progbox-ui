import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import LabSummary from "./LabSummary.vue";
import { player, report, stubClipboard } from "../../test/labFixtures";

vi.mock("./LabChart.vue", () => ({
  default: { name: "LabChart", props: { series: Array, labels: Array }, template: `<div data-test="chart">{{ JSON.stringify(series) }}</div>` },
}));

const players = [player(1, "Ann Able", 2.5), player(2, "Bo Baker", -1.2, null), player(3, "Cy Carr", 0.4), player(4, "Di Dunn", -3), player(5, "Ed Ely", 1), player(6, "Fay Fox", 0)];

describe("LabSummary", () => {
  it("shows the verdict, flags, league fixes, KPIs for both sides and risers/fallers", () => {
    const w = mount(LabSummary, { props: { report: report(), players, summary: null } });
    expect(w.find('[data-test="verdict"]').text()).toBe("Review flags");
    expect(w.find('[data-test="verdict"]').classes()).toContain("warn");
    expect(w.findAll('[data-test="flags"] li').map((li) => li.classes()[0])).toEqual(["warn", "error"]);
    expect(w.text()).toContain("League: Real NBA 2025-26 · Data: BBGM");
    expect(w.text()).toContain("Imputed 3 missing ratings");
    expect(w.text()).not.toContain("Old export");

    const head = w.find('[data-test="kpis"] thead').text();
    expect(head).toContain("net@3.2.1");
    expect(head).toContain("net@4.3.0");
    const meanRow = w.findAll('[data-test="kpis"] tbody tr').find((r) => r.text().startsWith("Mean ΔOVR"))!;
    expect(meanRow.findAll("td").map((td) => td.text())).toEqual(["Mean ΔOVR", "-0.20", "+0.50"]);

    const series = JSON.parse(w.find('[data-test="chart"]').text());
    expect(series.map((s: { role: string }) => s.role)).toEqual(["baseline", "script"]);
    expect(series[1].data).toEqual([1.2, null, null, -3.1]);

    const tables = w.findAll(".lab-grid2")[1]!.findAll("tbody");
    expect(tables[0]!.findAll("tr").map((r) => r.find("td").text())).toEqual(["Ann Able", "Ed Ely", "Cy Carr", "Fay Fox", "Bo Baker"]);
    expect(tables[1]!.findAll("tr").map((r) => r.find("td").text())).toEqual(["Di Dunn", "Bo Baker", "Fay Fox", "Cy Carr", "Ed Ely"]);
    expect(tables[1]!.findAll("tr")[1]!.findAll("td")[2]!.text()).toBe("–");
  });

  it("says No flags and hides the baseline column for a script-only run", () => {
    const w = mount(LabSummary, { props: { report: report({ verdict: "No flags", flags: [], baseline: null, league: { id: "x", name: "Custom", credit: null, issues: [], imputedRows: 0 } }), players, summary: null } });
    expect(w.find('[data-test="verdict"]').classes()).toContain("good");
    expect(w.find('[data-test="flags"]').text()).toContain("No flags");
    expect(w.find('[data-test="kpis"] thead').findAll("th")).toHaveLength(2);
    expect(JSON.parse(w.find('[data-test="chart"]').text())).toHaveLength(1);
  });

  it("copies a Discord summary comparing both sides and reports a blocked clipboard", async () => {
    const writeText = stubClipboard(true);
    const w = mount(LabSummary, { props: { report: report(), players, summary: null } });
    await w.find("button").trigger("click");
    await flushPromises();
    const text = writeText.mock.calls[0]![0] as string;
    expect(text).toContain("**NET Lab: net@4.3.0 vs net@3.2.1** · Review flags");
    expect(text).toContain("• League OVR collapses");
    expect(text).toContain("Mean ΔOVR -0.20 → +0.50 · god progs/offseason 0.70 → 2.10");
    expect(w.find('[role="status"]').text()).toBe("Copied");

    stubClipboard(false);
    const solo = mount(LabSummary, { props: { report: report({ baseline: null, flags: [] }), players, summary: null } });
    await solo.find("button").trigger("click");
    await flushPromises();
    expect(solo.find('[role="status"]').text()).toBe("Copy blocked by the browser");
  });

  it("copies the script-only line when there is no baseline", async () => {
    const writeText = stubClipboard(true);
    const w = mount(LabSummary, { props: { report: report({ baseline: null, flags: [] }), players, summary: null } });
    await w.find("button").trigger("click");
    await flushPromises();
    expect(writeText.mock.calls[0]![0]).toBe("**NET Lab: net@4.3.0** · Review flags\ndeep · Real NBA 2025-26\nMean ΔOVR +0.50 · god progs/offseason 2.10");
  });

  it("toggles summary.md when the run wrote one", async () => {
    const w = mount(LabSummary, { props: { report: report(), players, summary: "# Summary\nAll good" } });
    const toggle = w.findAll("button")[1]!;
    expect(w.find("pre").exists()).toBe(false);
    await toggle.trigger("click");
    expect(w.find("pre").text()).toContain("All good");
    expect(toggle.text()).toBe("Hide summary.md");
    await toggle.trigger("click");
    expect(w.find("pre").exists()).toBe(false);
  });
});
