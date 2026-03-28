import { expect, test } from "@playwright/test";

test("run detail shows running progress panel", async ({ page }) => {
  await page.goto("/runs/20260101120001");

  await expect(page.getByText("Live progress")).toBeVisible();
  await expect(page.getByText(/running · 0%/i)).toBeVisible();
  await expect(page.getByText(/Starting/)).toBeVisible();
});

test("run detail shows failed metadata state", async ({ page }) => {
  await page.goto("/runs/20260101120002");

  await expect(page.getByText("Status:")).toBeVisible();
  await expect(page.getByText("failed")).toBeVisible();
});

test("run detail shows completed metadata state", async ({ page }) => {
  await page.goto("/runs/20260101120000");

  await expect(page.getByText("Status:")).toBeVisible();
  await expect(page.getByText("complete")).toBeVisible();
  await expect(page.getByText("Charts, players, and exports: use the API or extend this view.")).toBeVisible();
});
