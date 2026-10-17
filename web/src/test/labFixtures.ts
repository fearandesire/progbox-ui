import { vi } from "vitest";
import type { LabDeepSide, LabKpis, LabPlayer, LabReport } from "../lib/labTypes";

// Replaces navigator.clipboard with a mock; setup.ts unstubs globals after each test.
export function stubClipboard(ok = true) {
  const writeText = ok ? vi.fn<(text: string) => Promise<void>>(async () => {}) : vi.fn<(text: string) => Promise<void>>(async () => { throw new Error("blocked"); });
  vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
  return writeText;
}

export const kpis = (over: Partial<LabKpis> = {}): LabKpis => ({
  runs: 1000, failedRuns: 0, invalidRows: 0, progressedPerRun: 400, meanDelta: 0.3, sdDelta: 2.1, pctPositive: 0.55, pctNegative: 0.4,
  deltaByAge: { "25-27": { n: 80, meanDelta: 1.2 }, "34+": { n: 20, meanDelta: -3.1 } },
  godProgsPerRun: 0.7, medianPlayerSd: 1.8, over80Before: 12, over80After: 13, p99OvrAfter: 78, perEffect: 0.42, bpmEffect: 0.2,
  ...over,
});

export const player = (pid: number, name: string, meanDelta: number, per: number | null = 15): LabPlayer => ({
  pid, name, tid: 1, age: 27, per, bpm: 1, baseOvr: 55, runs: 1000, meanOvr: 55 + meanDelta, meanDelta, sdDelta: 1.5,
  min: -6, q10: -2.4, median: meanDelta, q90: 3.6, max: 9, pctPositive: 0.5, godRate: 0.01, attrDelta: {},
});

export const report = (over: Partial<LabReport> = {}): LabReport => ({
  verdict: "Review flags",
  flags: [{ level: "warn", text: "God progs up 3x" }, { level: "error", text: "League OVR collapses" }],
  mode: "deep",
  league: { id: "nba-2025-26", name: "Real NBA 2025-26", credit: "Data: BBGM", issues: [{ level: "fix", code: "imputed", text: "Imputed 3 missing ratings" }, { level: "warn", code: "old", text: "Old export" }], imputedRows: 3 },
  script: { id: "net@4.3.0", kpis: kpis({ meanDelta: 0.5, godProgsPerRun: 2.1 }), apiCalls: {}, eventTypes: {}, errors: [] },
  baseline: { id: "net@3.2.1", kpis: kpis({ meanDelta: -0.2, perEffect: null }), apiCalls: {}, errors: [] },
  deep: null,
  ...over,
});

const stat = (mean: number) => ({ mean, se: 0.1 });
export const deepSide = (offset: number): LabDeepSide => ({
  replicates: 200,
  failed: 0,
  ageCurve: { "25-27": 1 + offset, "34+": -3 + offset },
  trajectories: [],
  seasons: [2026, 2027].map((season, i) => ({
    season, progressed: stat(400), meanDelta: stat(0.2 + offset + i), god: stat(0.5), leagueMeanOvr: stat(47 + offset), count75: stat(20),
    count80: stat(8), maxOvr: stat(82), retired: stat(30), drafted: stat(60),
  })),
});
