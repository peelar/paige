import { defineConfig } from "@playwright/test";

const port = 3100;

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  forbidOnly: true,
  reporter: "line",
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    headless: true,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `pnpm start --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: "desktop",
      use: { viewport: { width: 1280, height: 800 } },
    },
    {
      name: "mobile",
      use: { viewport: { width: 390, height: 844 } },
    },
  ],
});
