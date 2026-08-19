import { describe, expect, it } from "vitest";
import { buildLayoutOverrides } from "./usePlotlyTheme";

describe("buildLayoutOverrides", () => {
  it("themes paper, plot, font, legend and hoverlabel", () => {
    const out = buildLayoutOverrides("light", {
      title: { text: "League Mean OVR" },
      legend: { orientation: "h" },
    });
    expect(out.paper_bgcolor).toBeTruthy();
    expect(out.plot_bgcolor).toBeTruthy();
    expect((out.font as { family: string }).family).toContain("Geist");
    expect((out.legend as { orientation: string }).orientation).toBe("h");
    expect((out.legend as { bordercolor: string }).bordercolor).toBeTruthy();
    expect(out.hoverlabel).toBeTruthy();
    // Original title text survives.
    expect((out.title as { text: string }).text).toBe("League Mean OVR");
  });

  it("covers every subplot axis key (xaxis2, yaxis3, ...)", () => {
    const out = buildLayoutOverrides("dark", {
      xaxis: { title: { text: "Age" } },
      xaxis2: { gridcolor: "#e2e8f0" },
      yaxis3: { zeroline: true },
      notAnAxis: { gridcolor: "#e2e8f0" },
    });
    for (const key of ["xaxis", "xaxis2", "yaxis3"]) {
      const axis = out[key] as { gridcolor: string; zerolinecolor: string };
      expect(axis.gridcolor).toBeTruthy();
      expect(axis.gridcolor).not.toBe("#e2e8f0");
      expect(axis.zerolinecolor).toBeTruthy();
    }
    expect((out.notAnAxis as { gridcolor: string }).gridcolor).toBe("#e2e8f0");
    expect((out.xaxis as { title: { text: string } }).title.text).toBe("Age");
  });

  it("remaps neutral shape/annotation colors in dark mode only", () => {
    const layout = {
      shapes: [
        { line: { color: "#1e293b" }, type: "line" },
        { line: { color: "#dc2626" }, type: "line" },
      ],
      annotations: [{ font: { color: "#0f172a" }, bgcolor: "rgba(255,255,255,0.85)" }],
    };
    const dark = buildLayoutOverrides("dark", layout);
    const darkShapes = dark.shapes as { line: { color: string } }[];
    expect(darkShapes[0].line.color).not.toBe("#1e293b");
    // Semantic red is untouched.
    expect(darkShapes[1].line.color).toBe("#dc2626");
    const darkAnn = dark.annotations as { font: { color: string }; bgcolor: string }[];
    expect(darkAnn[0].font.color).not.toBe("#0f172a");
    expect(darkAnn[0].bgcolor).toBe("rgba(15,23,42,0.85)");

    const light = buildLayoutOverrides("light", layout);
    const lightShapes = light.shapes as { line: { color: string } }[];
    expect(lightShapes[0].line.color).toBe("#1e293b");
  });

  it("does not mutate the input layout", () => {
    const layout = { xaxis: { gridcolor: "#e2e8f0" }, shapes: [{ line: { color: "#1e293b" } }] };
    const snapshot = JSON.parse(JSON.stringify(layout));
    buildLayoutOverrides("dark", layout);
    expect(layout).toEqual(snapshot);
  });
});
