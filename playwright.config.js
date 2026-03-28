const { defineConfig, devices } = require("@playwright/test");
const path = require("node:path");

const outputsDir = path.join(__dirname, "e2e", "fixtures", "outputs");

module.exports = defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["html", { outputFolder: "playwright-report" }], ["list"]] : "list",
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: "python -m uvicorn main:app --host 127.0.0.1 --port 8000",
      cwd: path.join(__dirname, "api"),
      url: "http://127.0.0.1:8000/docs",
      reuseExistingServer: !process.env.CI,
      env: {
        ...process.env,
        PROGBOX_OUTPUTS_DIR: outputsDir,
      },
    },
    {
      command: "pnpm --filter web dev -- --host 127.0.0.1 --port 5173",
      url: "http://127.0.0.1:5173",
      reuseExistingServer: !process.env.CI,
    },
  ],
});
