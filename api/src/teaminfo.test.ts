import { describe, expect, it } from "vitest";
import {
  SPECIAL_ENTRIES,
  generateTeaminfo,
  validateTeaminfo,
  InvalidTeaminfoError,
} from "./services/teaminfo.js";

describe("teaminfo", () => {
  it("maps active teams and appends specials", () => {
    const exportData = {
      teams: [
        { tid: 0, abbrev: "BOS", active: true },
        { tid: 1, abbrev: "NYK", active: true },
      ],
    };
    expect(generateTeaminfo(exportData)).toEqual({
      "0": "BOS",
      "1": "NYK",
      ...SPECIAL_ENTRIES,
    });
  });

  it("excludes inactive teams", () => {
    const exportData = {
      teams: [
        { tid: 0, abbrev: "BOS", active: true },
        { tid: 999, abbrev: "DEFUNCT", active: false },
        { tid: 1000, abbrev: "NOFLAG" },
      ],
    };
    const r = generateTeaminfo(exportData);
    expect(r["999"]).toBeUndefined();
    expect(r["1000"]).toBe("NOFLAG");
    expect(r["0"]).toBe("BOS");
  });

  it("validates teaminfo", () => {
    expect(() => validateTeaminfo(["a"])).toThrow(InvalidTeaminfoError);
    expect(validateTeaminfo({ "0": "BOS" })).toEqual({ "0": "BOS" });
  });
});
