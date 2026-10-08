import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LabNewView from "./LabNewView.vue";

vi.mock("../lib/api", () => ({
  fetchLabScripts: vi.fn(),
  fetchLabLeagues: vi.fn(),
  checkLabLeague: vi.fn(),
  fetchLabEstimate: vi.fn(),
  addLabScript: vi.fn(),
  createLabRun: vi.fn(),
  uploadLabLeague: vi.fn(),
  downloadLabLeagues: vi.fn(),
  labErrorMessage: (e: unknown, f: string) => (e instanceof Error ? e.message : f),
}));

import { addLabScript, checkLabLeague, createLabRun, fetchLabEstimate, fetchLabLeagues, fetchLabScripts } from "../lib/api";

const SCRIPTS = [
  { id: "net@3.2.1", role: "published", sha256: "a", source: "builtin:net-3.2.1", builtin: true, family: "net" },
  { id: "net@4.3.0", role: "candidate", sha256: "b", source: "builtin:net-4.3.0", builtin: true, family: "net" },
  { id: "hook@1.0.0", role: "published", sha256: "c", source: "builtin:worker-console", builtin: true, family: "hook" },
  { id: "net@4.4.0-draft.1", role: "draft", sha256: "d", source: "upload", uploadedAt: "2026-10-07T10:00:00Z", uploadedFile: "a.js", family: "net" },
  { id: "net@4.4.0-draft.2", role: "draft", sha256: "e", source: "upload", uploadedAt: "2026-10-08T10:00:00Z", uploadedFile: "b.js", family: "net" },
];
const LEAGUES = [
  { id: "nba-2025-26", name: "Real NBA 2025-26", source: "alexnoob", credit: "Real-player roster by alexnoob", isDefault: true, available: true },
  { id: "progbox-2017", name: "progbox default export", source: "repo", available: true },
];
const OK = { ok: true, issues: [{ level: "fix", code: "imputed-stats", text: "Imputed shot zones." }], season: 2025, phase: 0, imputed: [] };

async function mountView(path = "/lab") {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/lab", component: LabNewView }, { path: "/lab/runs/:id", component: { template: "<div />" } }, { path: "/lab/history", component: { template: "<div />" } }, { path: "/lab/scripts", component: { template: "<div />" } }] });
  await router.push(path);
  const wrapper = mount(LabNewView, { global: { plugins: [router] } });
  await flushPromises();
  return { wrapper, router };
}

beforeEach(() => {
  vi.useRealTimers();
  vi.mocked(fetchLabScripts).mockResolvedValue(SCRIPTS as never);
  vi.mocked(fetchLabLeagues).mockResolvedValue(LEAGUES as never);
  vi.mocked(checkLabLeague).mockResolvedValue(OK as never);
  vi.mocked(fetchLabEstimate).mockResolvedValue({ seconds: 135, basis: ["deep: 400 ms per replicate-season (measured)"] });
});

const options = (wrapper: Awaited<ReturnType<typeof mountView>>["wrapper"], sel: string) =>
  wrapper.findAll(`${sel} option`).filter((o) => !(o.element as HTMLOptionElement).disabled).map((o) => (o.element as HTMLOptionElement).value);

describe("LabNewView", () => {
  it("offers uploads to test, releases first under Compare against, and defaults to deep and the newest release", async () => {
    vi.useFakeTimers();
    const { wrapper } = await mountView();
    expect(options(wrapper, "#lab-script")).toEqual(["net@4.4.0-draft.2", "net@4.4.0-draft.1"]);
    expect((wrapper.find("#lab-script").element as HTMLSelectElement).value).toBe("net@4.4.0-draft.2");
    expect(options(wrapper, "#lab-baseline")).toEqual(["net@4.3.0", "net@3.2.1", "net@4.4.0-draft.2", "net@4.4.0-draft.1", ""]);
    expect(wrapper.findAll("#lab-baseline optgroup").map((g) => g.attributes("label"))).toEqual(["Releases", "Your drafts"]);
    expect((wrapper.find("#lab-baseline").element as HTMLSelectElement).value).toBe("net@4.3.0");
    expect(wrapper.find('[role="radio"][aria-checked="true"]').text()).toContain("Every offseason, 10 seasons");
    expect(wrapper.find('[data-test="locked-sizes"]').text()).toContain("200 replicates × 10 seasons");
    expect((wrapper.find("#lab-league").element as HTMLSelectElement).value).toBe("nba-2025-26");
    expect(wrapper.find('[data-test="credit"]').text()).toContain("alexnoob");
    expect(wrapper.find('[data-test="league-issues"]').text()).toContain("Imputed shot zones.");
    const preview = wrapper.find('[data-test="preview"]').text();
    expect(preview).toContain("net@4.4.0-draft.2");
    expect(preview).toContain("2024-25 real, then 9 simulated seasons");
    expect(preview).toContain("200 per script");

    await vi.advanceTimersByTimeAsync(500);
    await flushPromises();
    expect(fetchLabEstimate).toHaveBeenCalledWith(expect.objectContaining({ mode: "deep", script: "net@4.4.0-draft.2", baseline: "net@4.3.0", league: "nba-2025-26", unlock: undefined }));
    const est = wrapper.find('[data-test="estimate"]');
    expect(est.text()).toBe("~2 min");
    expect(est.attributes("title")).toBe("deep: 400 ms per replicate-season (measured)");

    await wrapper.find('[data-test="unlock"]').setValue(true);
    expect(wrapper.find('[data-test="locked-sizes"]').exists()).toBe(false);
    expect(wrapper.find("#lab-replicates").exists()).toBe(true);
  });

  it("switches timing cards and warns about mid-season files in Right now mode", async () => {
    vi.mocked(checkLabLeague).mockResolvedValue({ ...OK, season: 2017, phase: 1 });
    const { wrapper } = await mountView();
    const cards = wrapper.findAll('[role="radio"]');
    expect(cards.map((c) => c.find(".lab-mode__tag").text())).toEqual(["Simulated games", "Simulated games", "Real stats only"]);
    expect(wrapper.find('[data-test="mid-season"]').exists()).toBe(false);
    await wrapper.find('[data-mode="quick"]').trigger("click");
    expect(wrapper.find('[data-mode="quick"]').attributes("aria-checked")).toBe("true");
    expect(wrapper.find('[data-test="mid-season"]').text()).toBe("This file is mid-season. NET will read partial-season stats.");
    expect(wrapper.find('[data-test="preview"]').text()).toContain("1,000 per script");
    expect(wrapper.find('[data-test="mode-tip"]').text()).toContain("No games are played");
    await wrapper.find('[data-mode="season"]').trigger("click");
    expect(wrapper.find('[data-test="preview"]').text()).toContain("Once, after the 2017-18 season");
    expect(wrapper.find('[data-test="mid-season"]').exists()).toBe(false);
  });

  it("preselects settings handed over by Run test or Run again", async () => {
    const { wrapper } = await mountView("/lab?script=net@4.3.0&baseline=none&league=progbox-2017&mode=quick");
    expect((wrapper.find("#lab-script").element as HTMLSelectElement).value).toBe("net@4.3.0");
    expect((wrapper.find("#lab-baseline").element as HTMLSelectElement).value).toBe("");
    expect((wrapper.find("#lab-league").element as HTMLSelectElement).value).toBe("progbox-2017");
    expect(wrapper.find('[data-mode="quick"]').attributes("aria-checked")).toBe("true");
  });

  it("shows the assigned id and says when identical code reused an existing id", async () => {
    vi.mocked(addLabScript).mockResolvedValue({ entry: { id: "net@4.3.0", family: "net", version: "4.3.0", role: "candidate", sha256: "b", source: "builtin", declared: "4.3.0" }, created: false, notes: ["Same code as net@4.3.0; reusing it."] });
    const { wrapper } = await mountView();
    const file = new File(["bbgm.player.develop()"], "wip.js", { type: "text/javascript" });
    Object.defineProperty(file, "text", { value: () => Promise.resolve("bbgm.player.develop()") });
    const input = wrapper.find("#lab-script-file");
    Object.defineProperty(input.element, "files", { value: [file] });
    await input.trigger("change");
    await flushPromises();
    expect(addLabScript).toHaveBeenCalledWith({ source: "bbgm.player.develop()", filename: "wip.js", family: "net" });
    const assigned = wrapper.find('[data-test="assigned"]');
    expect(assigned.text()).toContain("net@4.3.0");
    expect(assigned.text()).toContain("Identical code was already saved");
  });

  it("blocks Run when the league has errors, and starts a run otherwise", async () => {
    vi.mocked(checkLabLeague).mockResolvedValueOnce({ ok: false, issues: [{ level: "error", code: "no-players", text: "The export has no players." }], season: 2025, phase: 0, imputed: [] });
    const { wrapper, router } = await mountView();
    expect(wrapper.find('[data-test="league-issues"]').text()).toContain("The export has no players.");
    expect(wrapper.find('[data-test="run"]').attributes("disabled")).toBeDefined();

    await wrapper.find("#lab-league").setValue("progbox-2017");
    await flushPromises();
    expect(wrapper.find('[data-test="run"]').attributes("disabled")).toBeUndefined();
    vi.mocked(createLabRun).mockResolvedValue({ runId: "20261008000001", queueId: "q-1-1", state: "running" });
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(createLabRun).toHaveBeenCalledWith(expect.objectContaining({ mode: "deep", script: "net@4.4.0-draft.2", baseline: "net@4.3.0", league: "progbox-2017", seed: 69 }));
    expect(router.currentRoute.value.fullPath).toBe("/lab/runs/20261008000001");
  });
});
