import { expect, test } from "@playwright/test";
import { renderRunHtml, type ExportableReport } from "../lab/src/exportHtml.ts";

test("season HTML exports show single-point data before hover @smoke", async ({ page }) => {
  const stat = (mean: number) => ({ mean, se: 0.01 });
  const report: ExportableReport = {
    mode: "season",
    lab: { version: "fixture", checks: { version: 2, rulesSha256: "fixture" } },
    runDetails: { runs: 200 },
    league: { id: "fixture", name: "Fixture league" },
    script: { id: "candidate", kpis: {} },
    deep: {
      start: { leagueMeanOvr: 52, count75: 3, count80: 1 },
      script: {
        seasons: [{ season: 2026, leagueMeanOvr: stat(51.8), count75: stat(3), count80: stat(1), maxOvr: stat(80), god: stat(4), meanDelta: stat(-1) }],
      },
    },
  };
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setContent(renderRunHtml(report, "20261017004309"));
  for (const name of ["Best player OVR, OVR", "God progs per offseason, God progs", "Mean OVR change from NET, ΔOVR per player"]) {
    const chart = page.getByRole("img", { name, exact: true });
    await expect(chart.locator('circle:not([opacity="0"])')).toHaveCount(1);
    const labels = await chart.locator('text[text-anchor="end"]').allTextContents();
    expect(new Set(labels).size).toBe(labels.length);
  }
  expect(errors).toEqual([]);
});

test("legacy and all-failed HTML exports render without invalid chart geometry @smoke", async ({ page }) => {
  const legacy: ExportableReport = {
    mode: "deep",
    league: { id: "legacy" },
    script: { id: "candidate", kpis: { deltaByAge: {} } },
    deep: { script: { seasons: [{ leagueMeanOvr: { mean: 50 }, count75: { mean: 2 }, count80: { mean: 1 }, god: { mean: 3 } }] } },
  };
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const [report, charts] of [[legacy, 4], [{ ...legacy, deep: { script: { seasons: [], ageCurve: {} } } }, 0]] as const) {
    await page.goto("about:blank");
    await page.setContent(renderRunHtml(report, "legacy"));
    await expect(page.getByRole("heading", { name: "Run details" })).toBeVisible();
    await expect(page.locator("svg[data-chart]")).toHaveCount(charts);
    expect(await page.locator("svg").evaluateAll((svgs) => svgs.some((svg) => /NaN|Infinity/.test(svg.outerHTML)))).toBe(false);
  }
  expect(errors).toEqual([]);
});
