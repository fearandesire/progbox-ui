import { describe, expect, it } from "vitest";
import {
  baselineDrafts,
  compareVersions,
  defaultBaseline,
  etaText,
  familyLabel,
  isMidSeason,
  matchesScript,
  releases,
  statsReadText,
  tableOrder,
  uploadedText,
  uploads,
} from "./labScripts";
import type { LabScript } from "./labTypes";

const s = (id: string, role: LabScript["role"], extra: Partial<LabScript> = {}): LabScript => ({
  id,
  role,
  sha256: "x",
  source: role === "draft" ? "upload" : "builtin:x",
  builtin: role !== "draft",
  ...extra,
});

const ALL = [
  s("net@3.2.1", "published"),
  s("net@4.4.0-draft.2", "draft", { uploadedAt: "2026-10-08T10:00:00Z", uploadedFile: "akshay_v44_wip.js" }),
  s("hook@1.0.0", "published"),
  s("net@4.3.0", "candidate"),
  s("net@4.4.0-draft.10", "draft", { uploadedAt: "2026-10-08T12:00:00Z" }),
  s("net@3.1.0", "published"),
];

describe("version order", () => {
  it("orders numbers, then drafts before the release", () => {
    const ids = ["net@4.4.0", "net@4.4.0-draft.2", "net@4.10.0", "net@4.4.0-draft.10", "net@4.3.1"];
    expect([...ids].sort(compareVersions)).toEqual(["net@4.3.1", "net@4.4.0-draft.2", "net@4.4.0-draft.10", "net@4.4.0", "net@4.10.0"]);
  });
});

describe("Compare against", () => {
  it("lists the next release first, then published newest first, never the hook", () => {
    expect(releases(ALL).map((x) => x.id)).toEqual(["net@4.3.0", "net@3.2.1", "net@3.1.0"]);
  });

  it("defaults to the next release, else the newest published, else none", () => {
    expect(defaultBaseline(ALL)).toBe("net@4.3.0");
    expect(defaultBaseline(ALL.filter((x) => x.role !== "candidate"))).toBe("net@3.2.1");
    expect(defaultBaseline(ALL.filter((x) => x.role === "draft"))).toBe("");
  });

  it("offers drafts after the releases, newest version first", () => {
    expect(baselineDrafts(ALL).map((x) => x.id)).toEqual(["net@4.4.0-draft.10", "net@4.4.0-draft.2"]);
  });
});

describe("Script to test", () => {
  it("lists uploads only, newest upload first", () => {
    expect(uploads(ALL).map((x) => x.id)).toEqual(["net@4.4.0-draft.10", "net@4.4.0-draft.2"]);
  });

  it("works with the older API shape (createdAt, builtin: source)", () => {
    const old = [
      { id: "net@4.3.0", role: "candidate", sha256: "b", createdAt: "", source: "builtin:net-4.3.0" },
      { id: "net@4.4.0-draft.1", role: "draft", sha256: "c", createdAt: "2026-10-01", source: "upload" },
    ] as LabScript[];
    expect(uploads(old).map((x) => x.id)).toEqual(["net@4.4.0-draft.1"]);
    expect(defaultBaseline(old)).toBe("net@4.3.0");
  });
});

describe("Scripts table", () => {
  it("groups NET scripts before the hook, newest first", () => {
    expect(tableOrder(ALL).map((x) => x.id)).toEqual([
      "net@4.4.0-draft.10",
      "net@4.4.0-draft.2",
      "net@4.3.0",
      "net@3.2.1",
      "net@3.1.0",
      "hook@1.0.0",
    ]);
  });

  it("names family groups with the right plural", () => {
    expect(familyLabel("net", 5)).toBe("NET scripts · 5 versions");
    expect(familyLabel("hook", 1)).toBe("WorkerConsole hook, runs before NET every offseason · 1 version");
  });

  it("searches id and file name and filters by status", () => {
    const d = ALL[1]!;
    expect(matchesScript(d, "AKSHAY", "all")).toBe(true);
    expect(matchesScript(d, "", "official")).toBe(false);
    expect(matchesScript(ALL[0]!, "", "official")).toBe(true);
    expect(matchesScript(ALL[0]!, "", "draft")).toBe(false);
  });
});

describe("Run preview", () => {
  it("says which stats NET reads in each mode", () => {
    const opening = { season: 2025, phase: 0 };
    expect(statsReadText("deep", opening)).toBe("2024-25 real, then 9 simulated seasons");
    expect(statsReadText("season", opening)).toBe("Simulated 2025-26");
    expect(statsReadText("quick", opening)).toBe("2024-25 real, from the file");
    expect(statsReadText("quick", { season: 2017, phase: 1 })).toBe("2017-18 partial, from the file");
  });

  it("flags regular-season files as mid-season", () => {
    expect(isMidSeason({ phase: 1 })).toBe(true);
    expect(isMidSeason({ phase: 2 })).toBe(true);
    expect(isMidSeason({ phase: 0 })).toBe(false);
    expect(isMidSeason(null)).toBe(false);
  });

  it("rounds the estimate to whole minutes, at least one", () => {
    expect(etaText(453)).toBe("~8 min");
    expect(etaText(20)).toBe("~1 min");
    expect(etaText(null)).toBe("");
  });
});

describe("uploadedText", () => {
  const now = new Date("2026-10-08T12:00:00").getTime();
  it.each([
    ["2026-10-08T11:48:00", "12 min ago"],
    ["2026-10-08T10:00:00", "2 h ago"],
    ["2026-10-07T09:00:00", "yesterday"],
    ["2026-10-04T12:00:00", "4 days ago"],
    ["2026-09-19T12:00:00", "Sep 19"],
    ["2024-05-02T12:00:00", "May 2024"],
    [null, "–"],
  ] as const)("reads %s as %s", (iso, out) => {
    expect(uploadedText(iso, now)).toBe(out);
  });
});
