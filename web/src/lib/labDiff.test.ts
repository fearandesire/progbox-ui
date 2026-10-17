import { describe, expect, it } from "vitest";
import { ignoreWhitespace, smartDiff, splitRows, unchangedText } from "./labDiff";
import type { LabDiffRow } from "./labTypes";

/** Build API rows from a compact spec: " x" context, "-x" deleted, "+x" added. */
function rows(spec: string[]): LabDiffRow[] {
  let a = 0;
  let b = 0;
  return spec.map((line) => {
    const text = line.slice(1);
    if (line[0] === "-") return { op: "del", a: ++a, b: null, text };
    if (line[0] === "+") return { op: "add", a: null, b: ++b, text };
    return { op: "ctx", a: ++a, b: ++b, text };
  });
}

const ctx = (n: number, from = 1) => Array.from({ length: n }, (_, i) => ` line ${from + i}`);

describe("smartDiff", () => {
  it("collapses long unchanged runs into gap rows and keeps 3 lines of context", () => {
    const out = smartDiff(rows([...ctx(10), "-  godProgCap: 4,", "+  godProgCap: 3,", ...ctx(10, 11)]));
    expect(out.map((r) => r.op)).toEqual(["gap", "ctx", "ctx", "ctx", "del", "add", "ctx", "ctx", "ctx", "gap"]);
    expect(out[0]).toMatchObject({ op: "gap", count: 7, text: "7 unchanged lines" });
    expect(out.at(-1)).toMatchObject({ count: 7 });
  });

  it("does not collapse when the unchanged run fits inside the context", () => {
    const out = smartDiff(rows([...ctx(2), "-a", "+b", ...ctx(2, 3)]));
    expect(out.some((r) => r.op === "gap")).toBe(false);
    expect(out).toHaveLength(6);
  });

  it("joins two nearby changes into one hunk when their context overlaps", () => {
    const out = smartDiff(rows(["-a", "+A", ...ctx(5), "-b", "+B"]));
    expect(out.filter((r) => r.op === "gap")).toEqual([]);
    const far = smartDiff(rows(["-a", "+A", ...ctx(8), "-b", "+B"]));
    expect(far.filter((r) => r.op === "gap")).toMatchObject([{ count: 2 }]);
  });

  it("hides whitespace-only edits", () => {
    const out = smartDiff(rows([...ctx(10), "-const x=1;", "+const x = 1;", ...ctx(10, 11)]));
    expect(out).toEqual([{ op: "gap", count: 21, text: "21 unchanged lines" }]);
  });

  it("returns a single gap for an identical file", () => {
    expect(smartDiff(rows(ctx(1186)))).toEqual([{ op: "gap", count: 1186, text: "1,186 unchanged lines" }]);
  });
});

describe("ignoreWhitespace", () => {
  it("keeps real edits and uneven blocks as they are", () => {
    const input = rows(["-a", "-b", "+a"]);
    expect(ignoreWhitespace(input)).toEqual(input);
    const real = rows(["-x = 1", "+x = 2"]);
    expect(ignoreWhitespace(real)).toEqual(real);
  });
});

describe("splitRows", () => {
  it("pairs deletions with the additions that follow and pads the shorter side", () => {
    const out = splitRows(rows([" head", "-old 1", "-old 2", "+new 1", " tail"]));
    expect(out).toEqual([
      { left: { op: "ctx", no: 1, text: "head" }, right: { op: "ctx", no: 1, text: "head" } },
      { left: { op: "del", no: 2, text: "old 1" }, right: { op: "add", no: 2, text: "new 1" } },
      { left: { op: "del", no: 3, text: "old 2" }, right: { op: "empty", no: null, text: "" } },
      { left: { op: "ctx", no: 4, text: "tail" }, right: { op: "ctx", no: 3, text: "tail" } },
    ]);
  });

  it("puts gap rows on both sides", () => {
    const [first] = splitRows([{ op: "gap", count: 3, text: unchangedText(3) }]);
    expect(first!.left).toEqual(first!.right);
    expect(first!.left.text).toBe("3 unchanged lines");
  });

  it("says line, not lines, for one", () => {
    expect(unchangedText(1)).toBe("1 unchanged line");
  });
});
