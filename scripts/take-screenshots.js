const { chromium } = require('@playwright/test');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 }
  });
  const page = await context.newPage();

  // Navigate to home page
  await page.goto('http://127.0.0.1:5173');

  // Wait for page to load
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);

  // Take screenshot of home page
  const screenshotsDir = path.join(__dirname, '..', 'docs', 'screenshots');
  await page.screenshot({
    path: path.join(screenshotsDir, 'home-page.png'),
    fullPage: true
  });

  console.log('Screenshot saved to docs/screenshots/home-page.png');

  await browser.close();
})();
