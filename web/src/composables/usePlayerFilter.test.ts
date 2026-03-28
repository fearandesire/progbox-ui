import { describe, expect, it } from "vitest";
import { usePlayerFilter } from "./usePlayerFilter";

describe("usePlayerFilter", () => {
  it("returns all rows when no filters are set", () => {
    const rows = [
      { team: "BOS", age: 20 },
      { team: "NYK" },
      { team: "GSW", age: 27 },
    ];

    const { filtered } = usePlayerFilter(() => rows);

    expect(filtered.value).toEqual(rows);
  });

  it("filters by team and age bounds, treating missing age as 0", () => {
    const rows = [
      { team: "BOS", age: 20 },
      { team: "BOS" },
      { team: "NYK", age: 24 },
      { team: "BOS", age: 31 },
    ];
    const { team, ageMin, ageMax, filtered } = usePlayerFilter(() => rows);

    team.value = "BOS";
    ageMin.value = 21;
    ageMax.value = 30;

    expect(filtered.value).toEqual([]);
  });
});
