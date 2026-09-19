import { describe, expect, it } from "vitest";
import {
  compareBaselineFor,
  PUBLISHED_PROGRESSION_VERSION,
  versionMeta,
  versionRole,
} from "./progressionVersions.js";

describe("progressionVersions", () => {
  it("publishes v321 as the NET baseline id", () => {
    expect(PUBLISHED_PROGRESSION_VERSION).toBe("v321");
    expect(versionRole("v321")).toBe("published");
    expect(versionRole("v43")).toBe("candidate");
    expect(versionRole("v41")).toBe("legacy");
  });

  it("pairs every non-published pick against published v321", () => {
    expect(compareBaselineFor("v43")).toBe("v321");
    expect(compareBaselineFor("v41")).toBe("v321");
  });

  it("pairs published itself against candidate v43", () => {
    expect(compareBaselineFor("v321")).toBe("v43");
  });

  it("exposes catalog meta with Published/Candidate/Legacy roles", () => {
    expect(versionMeta()).toEqual([
      { id: "v321", label: "NET 3.2", role: "published" },
      { id: "v41", label: "v4.1", role: "legacy" },
      { id: "v43", label: "v4.3", role: "candidate" },
    ]);
  });
});
