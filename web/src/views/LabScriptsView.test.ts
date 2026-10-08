import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LabScriptsView from "./LabScriptsView.vue";

vi.mock("../lib/api", () => ({
  fetchLabScripts: vi.fn(),
  addLabScript: vi.fn(),
  deleteLabScript: vi.fn(),
  restoreLabScript: vi.fn(),
  fetchLabScriptSource: vi.fn(),
  fetchLabScriptDiff: vi.fn(),
  labScriptSourceUrl: (id: string, original = false) => `/api/lab/scripts/${id}/source${original ? "?original=1" : ""}`,
  labErrorMessage: (e: unknown, f: string) => (e instanceof Error ? e.message : f),
}));

import { deleteLabScript, fetchLabScriptDiff, fetchLabScriptSource, fetchLabScripts, restoreLabScript } from "../lib/api";

const SCRIPTS = [
  { id: "net@4.4.0-draft.2", family: "net", role: "draft", builtin: false, source: "upload", uploadedFile: "akshay_v44_wip.js", uploadedAt: "2026-10-08T10:00:00Z", runs: 3, sha256: "5c0d8e71aa", header: "/**\n * v4.4.0\n */", bumped: null },
  { id: "net@4.4.0-draft.1", family: "net", role: "draft", builtin: false, source: "upload", uploadedFile: "first.js", uploadedAt: "2026-10-07T10:00:00Z", runs: 0, sha256: "e2b4419a", header: null, bumped: null },
  { id: "net@4.3.1-draft.1", family: "net", role: "draft", builtin: false, source: "upload", uploadedFile: "NoEyeTest.js", uploadedAt: "2026-10-08T09:00:00Z", runs: 1, sha256: "7d33b0fe", header: null, bumped: { from: "4.3.0", to: "4.3.1" } },
  { id: "net@4.3.0", family: "net", role: "candidate", builtin: true, source: "Built in, GitHub release v4.3.0", uploadedFile: null, uploadedAt: "2025-09-19T00:00:00Z", runs: 6, sha256: "c5959e65", header: null, bumped: null },
  { id: "hook@1.0.0", family: "hook", role: "published", builtin: true, source: "Built in, WorkerConsole.js", uploadedFile: null, uploadedAt: "2025-09-19T00:00:00Z", runs: 15, sha256: "c0f12d9d", header: null, bumped: null },
];

async function mountView() {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/lab/scripts", component: LabScriptsView }, { path: "/lab", component: { template: "<div />" } }, { path: "/lab/history", component: { template: "<div />" } }] });
  await router.push("/lab/scripts");
  const wrapper = mount(LabScriptsView, { global: { plugins: [router] }, attachTo: document.body });
  await flushPromises();
  return { wrapper, router };
}

const row = (w: Awaited<ReturnType<typeof mountView>>["wrapper"], id: string) => w.find(`tr[data-id="${id}"]`);

beforeEach(() => {
  vi.useRealTimers();
  vi.mocked(fetchLabScripts).mockResolvedValue(structuredClone(SCRIPTS) as never);
  vi.mocked(deleteLabScript).mockImplementation(async (id: string) => ({ id, trashedUntil: "2026-10-15" }));
  vi.mocked(restoreLabScript).mockResolvedValue({});
});

describe("LabScriptsView", () => {
  it("groups families with the right plural, shows dot statuses with tooltips and locks releases", async () => {
    const { wrapper } = await mountView();
    expect(wrapper.findAll("tr.fam").map((r) => r.text())).toEqual([
      "NET scripts · 4 versions",
      "WorkerConsole hook, runs before NET every offseason · 1 version",
    ]);
    const st = row(wrapper, "net@4.3.0").find('[data-test="status-cell"]');
    expect(st.text()).toBe("Next release");
    expect(st.attributes("title")).toContain("4.3.0 prerelease");
    expect(row(wrapper, "net@4.3.0").find('[data-test="locked"]').attributes("title")).toBe("Built-in scripts can't be deleted");
    expect(row(wrapper, "net@4.3.0").find('input[type="checkbox"]').exists()).toBe(false);
    expect(row(wrapper, "hook@1.0.0").find('[data-test="run"]').attributes("disabled")).toBeDefined();
    expect(row(wrapper, "net@4.3.1-draft.1").find('[data-test="bumped"]').attributes("title")).toContain("NoEyeTest.js said v4.3.0");
    wrapper.unmount();
  });

  it("filters by search and status", async () => {
    const { wrapper } = await mountView();
    await wrapper.find('[data-test="search"]').setValue("akshay");
    expect(wrapper.findAll("tr.row").map((r) => r.attributes("data-id"))).toEqual(["net@4.4.0-draft.2"]);
    await wrapper.find('[data-test="search"]').setValue("");
    await wrapper.find('[data-test="status"]').setValue("official");
    expect(wrapper.findAll("tr.row").map((r) => r.attributes("data-id"))).toEqual(["net@4.3.0", "hook@1.0.0"]);
    await wrapper.find('[data-test="search"]').setValue("nothing-matches");
    expect(wrapper.text()).toContain("No versions match.");
    wrapper.unmount();
  });

  it("confirms a delete inline, can take the runs too, and undoes it", async () => {
    const { wrapper } = await mountView();
    await row(wrapper, "net@4.4.0-draft.2").find('[data-test="delete"]').trigger("click");
    const confirm = wrapper.find('[data-test="confirm"]');
    expect(confirm.text()).toContain("Delete net@4.4.0-draft.2?");
    expect(confirm.text()).toContain("Also delete its 3 runs");
    await confirm.find('[data-test="also-runs"]').setValue(true);
    await confirm.find('[data-test="confirm-delete"]').trigger("click");
    await flushPromises();
    expect(deleteLabScript).toHaveBeenCalledWith("net@4.4.0-draft.2", true);
    expect(row(wrapper, "net@4.4.0-draft.2").exists()).toBe(false);
    const toast = document.body.querySelector(".toast");
    expect(toast?.textContent).toContain("Deleted net@4.4.0-draft.2. It stays in the trash for 7 days.");
    (toast?.querySelector("button") as HTMLButtonElement).click();
    await flushPromises();
    expect(restoreLabScript).toHaveBeenCalledWith("net@4.4.0-draft.2");
    expect(row(wrapper, "net@4.4.0-draft.2").exists()).toBe(true);
    wrapper.unmount();
  });

  it("bulk-deletes selected drafts", async () => {
    const { wrapper } = await mountView();
    await wrapper.find('[data-test="select-all"]').setValue(true);
    expect(wrapper.find('[data-test="bulk"]').text()).toContain("3 drafts selected");
    await wrapper.find('[data-test="bulk-delete"]').trigger("click");
    await flushPromises();
    expect(vi.mocked(deleteLabScript).mock.calls.map((c) => c[0]).sort()).toEqual(["net@4.3.1-draft.1", "net@4.4.0-draft.1", "net@4.4.0-draft.2"]);
    expect(wrapper.findAll("tr.row").map((r) => r.attributes("data-id"))).toEqual(["net@4.3.0", "hook@1.0.0"]);
    expect(document.body.querySelector(".toast")?.textContent).toContain("Deleted 3 drafts.");
    wrapper.unmount();
  });

  it("opens New test with the script picked, or with a release as the comparison", async () => {
    const { wrapper, router } = await mountView();
    await row(wrapper, "net@4.4.0-draft.2").find('[data-test="run"]').trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe("/lab?script=net@4.4.0-draft.2");
    wrapper.unmount();
  });

  it("shows the bumped script and a smart diff against the collided version", async () => {
    vi.mocked(fetchLabScriptSource).mockResolvedValue("/**\n * v4.3.1\n */\nconst CFG = {};\n");
    const ctx = Array.from({ length: 10 }, (_, i) => ({ op: "ctx" as const, a: i + 3, b: i + 3, text: `line ${i}` }));
    vi.mocked(fetchLabScriptDiff).mockResolvedValue({
      against: "net@4.3.0",
      rows: [{ op: "del", a: 1, b: null, text: " * v4.3.0" }, { op: "add", a: null, b: 1, text: " * v4.3.1" }, ...ctx],
    });
    const { wrapper } = await mountView();
    await row(wrapper, "net@4.3.1-draft.1").find('[data-test="bumped"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-test="dlg-source"]').text()).toContain("const CFG = {};");
    await wrapper.find('[data-tab="taken"]').trigger("click");
    await flushPromises();
    expect(fetchLabScriptDiff).toHaveBeenCalledWith("net@4.3.1-draft.1", "net@4.3.0");
    expect(wrapper.find('[data-test="dlg-note"]').text()).toContain("compared with net@4.3.0, the code that already held v4.3.0");
    const lines = wrapper.findAll('[data-test="dlg-diff"] > div');
    expect(lines.at(-1)!.text()).toBe("7 unchanged lines");
    await wrapper.find('[data-view="unified"]').trigger("click");
    expect(wrapper.findAll('[data-test="dlg-diff"] > div')).toHaveLength(12);
    await wrapper.find('[data-view="split"]').trigger("click");
    expect(wrapper.find('[data-test="dlg-diff"]').classes()).toContain("lab-diff--split");
    wrapper.unmount();
  });
});
