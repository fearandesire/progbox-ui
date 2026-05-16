import { expect, test } from "@playwright/test";

test("run detail shows running progress panel", async ({ page }) => {
  await page.goto("/runs/20260101120001");

  const summary = page.getByRole("region", { name: "Run summary" });

  await expect(page.getByText("Live progress")).toBeVisible();
  await expect(page.getByText("0%")).toBeVisible();
  await expect(page.getByText(/Starting/)).toBeVisible();
  await expect(summary.getByText("Status")).toBeVisible();
  await expect(summary.getByText("running", { exact: true })).toBeVisible();
});

test("run detail shows failed metadata state", async ({ page }) => {
  await page.goto("/runs/20260101120002");

  const summary = page.getByRole("region", { name: "Run summary" });

  await expect(summary).toBeVisible();
  await expect(summary.getByText("failed", { exact: true })).toBeVisible();
});

test("run detail shows completed metadata state", async ({ page }) => {
  await page.goto("/runs/20260101120000");

  const summary = page.getByRole("region", { name: "Run summary" });

  await expect(summary).toBeVisible();
  await expect(summary.getByText("complete", { exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Charts" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Download .xlsx" })).toBeVisible();
});
