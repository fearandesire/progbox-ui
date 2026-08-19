import { expect, test } from "@playwright/test";

// Run 20260101120000 carries a marker-accurate analysis_dashboard.html
// fixture and analysis_engine "python", so the Charts tab renders the
// native dashboard instead of the legacy iframe.

test("charts tab renders the native analysis dashboard @smoke", async ({ page }) => {
  await page.goto("/runs/20260101120000");
  await page.getByRole("tab", { name: "Charts" }).click();

  await expect(
    page.getByRole("heading", { name: "Monte Carlo Tuning Dashboard" }),
  ).toBeVisible();
  // Stat cards from the extracted payload.
  await expect(page.getByText("Convergence")).toBeVisible();
  await expect(page.getByText("98%")).toBeVisible();
  // Section chrome, natively rendered (no iframe).
  await expect(page.getByRole("heading", { name: "§1 · League Health" })).toBeVisible();
  await expect(page.locator("iframe")).toHaveCount(0);
});

test("native dashboard draws a real Plotly chart", async ({ page }) => {
  await page.goto("/runs/20260101120000");
  await page.getByRole("tab", { name: "Charts" }).click();

  // Plotly injects an svg.main-svg once the lazy chart actually renders.
  await expect(page.locator(".plotly-chart .main-svg").first()).toBeVisible({
    timeout: 20_000,
  });
});

test("player explorer selector drives the charts", async ({ page }) => {
  await page.goto("/runs/20260101120000");
  await page.getByRole("tab", { name: "Charts" }).click();

  const input = page.locator("#explorer-select");
  await expect(input).toHaveValue("Alpha Man (SEA, 24)");
  await expect(page.getByTestId("explorer-stats")).toContainText("age 24");

  await input.fill("Beta Guy (LAL, 31)");
  await input.dispatchEvent("change");
  await expect(page.getByTestId("explorer-stats")).toContainText("age 31");
});

test("escape hatch links to the original engine-rendered dashboard", async ({ page }) => {
  await page.goto("/runs/20260101120000");
  await page.getByRole("tab", { name: "Charts" }).click();

  const original = page.getByRole("link", { name: "Original" });
  await expect(original).toHaveAttribute(
    "href",
    /\/sims\/20260101120000\/analysis$/,
  );
  await expect(original).toHaveAttribute("target", "_blank");
});
