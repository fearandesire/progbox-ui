import { describe, expect, it } from "vitest";
import { resolveVersion, versionRole } from "./versions";

describe("historical progression versions", () => {
  it.each([
    ["v321", "v3.2.1", "published"],
    ["v41", "v4.1", "legacy"],
    ["v43", "v4.3", "candidate"],
    ["v3.2.1, current progression script", "v3.2.1", "published"],
    ["v4.1, new progression script with EWA and DWS on top of PER", "v4.1", "legacy"],
    ["v4.3, new and improved progression script", "v4.3", "candidate"],
  ] as const)("resolves %s", (input, expected, role) => {
    expect(resolveVersion(input)).toBe(expected);
    expect(versionRole(input)).toBe(role);
  });

  it("uses script_version when requested_version is missing or unrecognized", () => {
    expect(resolveVersion(null, "v321")).toBe("v3.2.1");
    expect(resolveVersion("future-version", "v41")).toBe("v4.1");
    expect(resolveVersion("v4.3", "v321")).toBe("v4.3");
    expect(versionRole(null, "v321")).toBe("published");
  });

  it.each(["v4.30", "foo321", "v4.3.2", "v321-extra", "v3.2.1, unknown script"])(
    "leaves %s unknown",
    (input) => {
      expect(resolveVersion(input)).toBeNull();
      expect(versionRole(input)).toBeNull();
    },
  );
});
