import { afterEach, describe, expect, it, vi } from "vitest";
import { KPI_ROWS, copyText, expectedStages, int, modeLabel, num, secondsText, sgn, sizeText, verdictClass } from "./labFormat";
import { stubClipboard } from "../test/labFixtures";
import type { LabKpis } from "./labTypes";

describe("modeLabel", () => {
  it("names each run mode the way the New test cards do", () => {
    expect(modeLabel("deep")).toBe("Every offseason, 10 seasons");
    expect(modeLabel("season")).toBe("After one season");
    expect(modeLabel("quick")).toBe("Right now");
  });

  it("passes an unknown mode through unchanged", () => {
    expect(modeLabel("legacy")).toBe("legacy");
  });
});

describe("number text", () => {
  it("sgn signs positives and shows a dash for missing values", () => {
    expect(sgn(1.234)).toBe("+1.23");
    expect(sgn(-0.5, 1)).toBe("-0.5");
    expect(sgn(0)).toBe("0.00");
    expect(sgn(null)).toBe("–");
    expect(sgn(undefined)).toBe("–");
    expect(sgn(Number.NaN)).toBe("–");
  });

  it("num fixes precision and shows a dash for missing values", () => {
    expect(num(3.14159)).toBe("3.1");
    expect(num(3.14159, 3)).toBe("3.142");
    expect(num(null)).toBe("–");
    expect(num(Number.NaN)).toBe("–");
  });

  it("int rounds without ever printing -0", () => {
    expect(int(2.6)).toBe("3");
    expect(int(-2.6)).toBe("-3");
    expect(int(-0.4)).toBe("0");
  });
});

describe("secondsText", () => {
  it("formats seconds, minutes and hours", () => {
    expect(secondsText(42.4)).toBe("42s");
    expect(secondsText(417)).toBe("6m 57s");
    expect(secondsText(3600 + 5 * 60 + 9)).toBe("1h 05m");
  });

  it("clamps negatives to zero and dashes missing or infinite values", () => {
    expect(secondsText(-3)).toBe("0s");
    expect(secondsText(null)).toBe("–");
    expect(secondsText(undefined)).toBe("–");
    expect(secondsText(Number.POSITIVE_INFINITY)).toBe("–");
  });
});

describe("verdictClass", () => {
  it("maps the old flag verdicts to a tone", () => {
    expect(verdictClass("No flags")).toBe("good");
    expect(verdictClass("Review flags")).toBe("warn");
    expect(verdictClass("Hold")).toBe("bad");
    expect(verdictClass(null)).toBe("neutral");
    expect(verdictClass("something else")).toBe("neutral");
  });
});

describe("sizeText", () => {
  it("describes the locked presets", () => {
    expect(sizeText("quick")).toBe("1000 offseasons");
    expect(sizeText("deep")).toBe("200 replicates × 10 seasons, plus 1000 single offseasons");
    expect(sizeText("season")).toBe("200 replicates × 1 season, plus 1000 single offseasons");
  });

  it("uses unlocked sizes when given", () => {
    expect(sizeText("quick", { runs: 50 })).toBe("50 offseasons");
    expect(sizeText("deep", { runs: 20, seasons: 3, replicates: 8 })).toBe("8 replicates × 3 seasons, plus 20 single offseasons");
    expect(sizeText("season", null)).toBe("200 replicates × 1 season, plus 1000 single offseasons");
  });
});

describe("expectedStages", () => {
  it("lists quick stages for script and baseline only in quick mode", () => {
    expect(expectedStages({ mode: "quick", script: "net@4.3.0", baseline: "net@3.2.1" }).map((s) => s.stage)).toEqual([
      "ingest",
      "quick:net@4.3.0",
      "quick:net@3.2.1",
      "report",
    ]);
  });

  it("adds multi-season stages outside quick mode and skips a missing baseline", () => {
    const stages = expectedStages({ mode: "deep", script: "net@4.3.0", baseline: null });
    expect(stages.map((s) => s.stage)).toEqual(["ingest", "quick:net@4.3.0", "deep:net@4.3.0", "report"]);
    expect(stages[2]!.label).toBe("net@4.3.0: multi-season replicates");
  });
});

describe("KPI_ROWS", () => {
  it("formats every headline number from a KPI block", () => {
    const k: LabKpis = {
      runs: 1000, failedRuns: 2, invalidRows: 1, progressedPerRun: 412.4, meanDelta: 0.31, sdDelta: 2.345, pctPositive: 0.556, pctNegative: 0.401,
      deltaByAge: {}, godProgsPerRun: 0.72, medianPlayerSd: 1.9, over80Before: 12, over80After: 14.5, p99OvrAfter: 78.25, perEffect: 0.5, bpmEffect: null,
    };
    expect(Object.fromEntries(KPI_ROWS.map((r) => [r.label, r.fmt(k)]))).toEqual({
      "Players progressed per offseason": "412",
      "Mean ΔOVR": "+0.31",
      "SD of ΔOVR": "2.35",
      "Median per-player SD": "1.90",
      "% up / % down": "56% / 40%",
      "God progs per offseason": "0.72",
      "80+ OVR players before → after": "12.0 → 14.5",
      "P99 OVR after": "78.3",
      "PER effect (ΔOVR per SD)": "0.50",
      "BPM effect (ΔOVR per SD)": "–",
      "Failed runs / invalid rows": "2 / 1",
    });
  });
});

describe("copyText", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports whether the clipboard accepted the text", async () => {
    const writeText = stubClipboard(true);
    expect(await copyText("hello")).toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello");
    writeText.mockRejectedValueOnce(new Error("denied"));
    expect(await copyText("again")).toBe(false);
  });
});
