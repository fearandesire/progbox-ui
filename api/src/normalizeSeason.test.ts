import { describe, expect, it } from "vitest";
import { normalizeSeason } from "./utils/normalizeSeason.js";

describe("normalizeSeason", () => {
  it("keeps finite numeric seasons", () => {
    expect(normalizeSeason(2024)).toBe(2024);
  });

  it("parses numeric string seasons", () => {
    expect(normalizeSeason("2025")).toBe(2025);
    expect(normalizeSeason(" 2026 ")).toBe(2026);
  });

  it("defaults invalid seasons to 2021", () => {
    expect(normalizeSeason(null)).toBe(2021);
    expect(normalizeSeason("playoffs")).toBe(2021);
    expect(normalizeSeason(Number.NaN)).toBe(2021);
  });
});
