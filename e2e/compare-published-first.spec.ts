import { expect, test } from "@playwright/test";

const candidateBuild = "20260101120000";
const publishedBuild = "20260102120000";

test("candidate-first historical pair renders Published first throughout comparison @smoke", async ({ page }) => {
  const labels: Record<string, string> = {
    [publishedBuild]: "NET 3.2",
    [candidateBuild]: "v4.3",
  };
  let requestedBuilds: string[] = [];

  await page.route("**/api/sims", async (route) => {
    await route.fulfill({
      json: [
        {
          build: candidateBuild,
          status: "complete",
          teams: [],
          requested_version: "v43",
          pair_id: "historical-pair",
        },
        {
          build: publishedBuild,
          status: "complete",
          teams: [],
          requested_version: "unknown historical label",
          script_version: "v321",
          pair_id: "historical-pair",
        },
      ],
    });
  });
  await page.route("**/api/sims/compare-data?*", async (route) => {
    requestedBuilds = new URL(route.request().url()).searchParams.get("builds")?.split(",") ?? [];
    const scripts = requestedBuilds.map((build) => labels[build]);
    await route.fulfill({
      json: {
        schemaVersion: 1,
        engine: "python",
        builds: requestedBuilds,
        hero: { title: "Progression Script Comparison", subtitle: "2 scripts" },
        statCards: [],
        sections: [
          { id: "scorecard", title: "§1 · Scorecard", intro: "Key metrics", charts: [] },
          {
            id: "drift",
            title: "§2 · Drift",
            intro: "Progression by script",
            charts: [{ kind: "figure", payloadId: "drift-chart", minHeight: 300 }],
          },
        ],
        figures: {
          "drift-chart": {
            data: scripts.map((name, index) => ({
              type: "scatter",
              mode: "lines",
              name,
              x: [0, 1],
              y: [index, index + 1],
            })),
            layout: { showlegend: true },
          },
        },
        playerExplorer: null,
        scorecard: {
          scripts,
          colors: ["#2563eb", "#dc2626"],
          metrics: [{ name: "Players", values: [100, 100] }],
        },
      },
    });
  });

  await page.goto(`/compare?builds=${candidateBuild},${publishedBuild}`);

  await expect(page.getByRole("heading", { name: "Published vs Candidate" })).toBeVisible();
  await expect(page.locator(".compare-runs__role")).toHaveText(["Published", "Candidate"]);
  await expect(page.locator(".compare-runs__id")).toHaveText([publishedBuild, candidateBuild]);
  await expect(page.locator(".scorecard__script-head")).toHaveText(["NET 3.2", "v4.3"]);
  expect(requestedBuilds).toEqual([publishedBuild, candidateBuild]);
  await expect(page.getByRole("link", { name: "Original" })).toHaveAttribute(
    "href",
    `/api/sims/compare?builds=${publishedBuild}%2C${candidateBuild}`,
  );

  const chart = page.locator("#drift .plotly-chart");
  await chart.scrollIntoViewIfNeeded();
  await expect(chart.locator(".main-svg").first()).toBeVisible();
  await expect(chart.locator(".legendtext")).toHaveText(["NET 3.2", "v4.3"]);
  await expect(page.locator("iframe")).toHaveCount(0);
});
