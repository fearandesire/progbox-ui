import { expect, test } from "@playwright/test";

test("run detail shows running progress panel", async ({ page }) => {
  await page.goto("/runs/20260101120001");

  await expect(page.getByText("Live progress")).toBeVisible();
  await expect(page.getByText(/running · 0%/i)).toBeVisible();
  await expect(page.getByText(/Starting/)).toBeVisible();
});

test("run detail shows failed metadata state", async ({ page }) => {
  await page.goto("/runs/20260101120002");

  await expect(page.getByText("Run Metadata")).toBeVisible();
  await expect(page.getByText("failed", { exact: true })).toBeVisible();
});

test("run detail shows completed metadata state", async ({ page }) => {
  await page.goto("/runs/20260101120000");

  await expect(page.getByText("Run Metadata")).toBeVisible();
  await expect(page.getByText("complete", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Charts" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Download Analysis (.xlsx)" })).toBeVisible();
});
