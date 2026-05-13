import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { describe, expect, it } from "vitest";
import { buildInputRows } from "./services/exportCleaner.js";

describe("exportCleaner", () => {
  it.each([
    ["none", null],
    ["nonnumeric-string", "playoffs"],
  ] as const)("invalid season %s uses default year for age", (_id, rawSeason) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pb-ec-"));
    try {
      const exportPayload = {
        version: 68,
        meta: { name: "Fixture League" },
        gameAttributes: { season: rawSeason, phase: "regularSeason" },
        players: [
          {
            pid: 0,
            firstName: "Alpha",
            lastName: "One",
            tid: 0,
            born: { year: 1992, loc: "USA" },
            stats: [{ per: 10, dws: 1, ewa: 0.5, playoffs: false, gp: 82 }],
            ratings: [
              {
                dIQ: 54,
                Dnk: 50,
                Drb: 51,
                End: 52,
                "2Pt": 53,
                FT: 54,
                Ins: 55,
                Jmp: 56,
                oIQ: 57,
                Pss: 58,
                Reb: 59,
                Spd: 60,
                Str: 61,
                "3Pt": 62,
                Hgt: 63,
                Ovr: 55,
              },
            ],
          },
        ],
      };
      const sampleTeaminfo = { "0": "BOS", "1": "NYK", "2": "GSW", "3": "SAC" };
      const exportPath = path.join(tmp, "export.json");
      const teaminfoPath = path.join(tmp, "teaminfo.json");
      fs.writeFileSync(exportPath, JSON.stringify(exportPayload), "utf8");
      fs.writeFileSync(teaminfoPath, JSON.stringify(sampleTeaminfo), "utf8");

      const exportData = JSON.parse(fs.readFileSync(exportPath, "utf8")) as Record<string, unknown>;
      const teamLookup = JSON.parse(fs.readFileSync(teaminfoPath, "utf8")) as Record<string, string>;
      const rows = buildInputRows(exportData, teamLookup, []);
      expect(rows.length).toBeGreaterThan(0);
      const ages = new Set(rows.map((r) => r.Age));
      expect(ages).toEqual(new Set([29]));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
