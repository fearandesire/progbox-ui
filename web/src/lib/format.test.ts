import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { duration, signed, timeAgo } from "./format";

describe("timeAgo", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-08T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns empty text for missing or invalid timestamps", () => {
    expect(timeAgo(null)).toBe("");
    expect(timeAgo(undefined)).toBe("");
    expect(timeAgo("not a date")).toBe("");
  });

  it("buckets the age into seconds, minutes, hours and days", () => {
    expect(timeAgo("2026-10-08T11:59:30Z")).toBe("just now");
    expect(timeAgo("2026-10-08T12:00:30Z")).toBe("just now");
    expect(timeAgo("2026-10-08T11:45:00Z")).toBe("15m ago");
    expect(timeAgo("2026-10-08T09:00:00Z")).toBe("3h ago");
    expect(timeAgo("2026-10-05T12:00:00Z")).toBe("3d ago");
  });
});

describe("duration", () => {
  it("formats elapsed time between two timestamps", () => {
    expect(duration("2026-10-08T12:00:00Z", "2026-10-08T12:04:18Z")).toBe("4m 18s");
    expect(duration("2026-10-08T12:00:00Z", "2026-10-08T12:00:09Z")).toBe("9s");
  });

  it("shows a dash when either end is missing, invalid or reversed", () => {
    expect(duration(null, "2026-10-08T12:00:00Z")).toBe("\u2014");
    expect(duration("2026-10-08T12:00:00Z", undefined)).toBe("\u2014");
    expect(duration("bad", "2026-10-08T12:00:00Z")).toBe("\u2014");
    expect(duration("2026-10-08T12:00:10Z", "2026-10-08T12:00:00Z")).toBe("\u2014");
  });
});

describe("signed", () => {
  it("adds a plus sign to positives only", () => {
    expect(signed(1.5)).toBe("+1.50");
    expect(signed(-1.5, 1)).toBe("-1.5");
    expect(signed(0)).toBe("0.00");
  });
});
