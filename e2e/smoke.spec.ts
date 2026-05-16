import { expect, test } from "@playwright/test";

test("dashboard loads and shows seeded runs @smoke", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Simulations", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "New simulation" })).toBeVisible();
  await expect(page.getByRole("link", { name: "20260101120000", exact: true })).toBeVisible();
});

test("dashboard links to completed run detail @smoke", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "20260101120000", exact: true }).click();

  await expect(page).toHaveURL(/\/runs\/20260101120000$/);
  await expect(page.getByText("Run summary")).toBeVisible();
  await expect(page.getByText("complete", { exact: true })).toBeVisible();
  await expect(page.getByText("v4.1")).toBeVisible();
});

test("run detail shows not-found state for missing build @smoke", async ({ page }) => {
  await page.goto("/runs/20260101235959");

  await expect(page.getByText(/Run not found/)).toBeVisible();
});
