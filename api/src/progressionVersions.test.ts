import { describe, expect, it } from "vitest";
import {
  compareBaselineFor,
  engineScriptId,
  PUBLISHED_PROGRESSION_VERSION,
  versionMeta,
  versionRole,
} from "./progressionVersions.js";

describe("progressionVersions", () => {
  it("publishes v3.2.1 as the NET baseline id", () => {
    expect(PUBLISHED_PROGRESSION_VERSION).toBe("v3.2.1");
    expect(versionRole("v3.2.1")).toBe("published");
    expect(versionRole("v4.3")).toBe("candidate");
    expect(versionRole("v4.1")).toBe("legacy");
  });

  it("pairs every non-published pick against published v3.2.1", () => {
    expect(compareBaselineFor("v4.3")).toBe("v3.2.1");
    expect(compareBaselineFor("v4.1")).toBe("v3.2.1");
  });

  it("pairs published itself against candidate v4.3", () => {
    expect(compareBaselineFor("v3.2.1")).toBe("v4.3");
  });

  it("maps public catalog ids to compact engine CLI ids", () => {
    expect(engineScriptId("v3.2.1")).toBe("v321");
    expect(engineScriptId("v4.1")).toBe("v41");
    expect(engineScriptId("v4.3")).toBe("v43");
  });

  it("exposes catalog meta with Published/Candidate/Legacy roles", () => {
    expect(versionMeta()).toEqual([
      { id: "v3.2.1", label: "NET 3.2", role: "published" },
      { id: "v4.1", label: "v4.1", role: "legacy" },
      { id: "v4.3", label: "v4.3", role: "candidate" },
    ]);
  });
});
