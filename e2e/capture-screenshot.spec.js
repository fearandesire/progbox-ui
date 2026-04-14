const { test } = require('@playwright/test');
const path = require('path');

test('capture home page screenshot', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);

  const screenshotsDir = path.join(__dirname, '..', 'docs', 'screenshots');
  await page.screenshot({
    path: path.join(screenshotsDir, 'home-page.png'),
    fullPage: false
  });
});
