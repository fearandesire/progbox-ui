import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as storage from "./services/storage.js";
import { useIsolatedOutputs, makeRunDir } from "./testUtils.js";

useIsolatedOutputs();

describe("storage", () => {
  it("lists runs sorted and skips invalid", () => {
    makeRunDir("20260101120000", { metadata: { status: "complete" } });
    makeRunDir("20260201120000", { metadata: { status: "running" } });
    const incomplete = makeRunDir("20260301120000", { metadata: { status: "failed" } });
    fs.unlinkSync(path.join(incomplete, "metadata.json"));
    makeRunDir("not-a-build", { metadata: { status: "complete" } });

    const builds = storage.listRuns().map((r) => r.build);
    expect(builds).toEqual(["20260201120000", "20260101120000"]);
  });

  it("getRun returns null for missing or invalid", () => {
    expect(storage.getRun("20260101120000")).toBeNull();
    expect(storage.getRun("bad-build")).toBeNull();
  });

  it("deleteRun removes directory", () => {
    const dir = makeRunDir("20260101120000");
    expect(storage.deleteRun("20260101120000")).toBe(true);
    expect(fs.existsSync(dir)).toBe(false);
    expect(storage.deleteRun("20260101120000")).toBe(false);
    expect(storage.deleteRun("not-a-build")).toBe(false);
  });
});
