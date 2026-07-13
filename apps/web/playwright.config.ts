import { defineConfig } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_PORT);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("Run Playwright through pnpm test:e2e so it can reserve an available port.");
}
const authState = `/tmp/docs-agent-playwright-auth-${port}.json`;

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
    env: {
      DOCS_AGENT_AUTH_TEST_MODE: "1",
      DOCS_AGENT_TEST_BASE_URL: `http://127.0.0.1:${port}`,
      DOCS_AGENT_OPERATOR_ACCESS: "test",
      DOCS_AGENT_READINESS_TEST_SCENARIOS: "1",
      DOCS_AGENT_MEMORY_TEST_SCENARIOS: "1",
      DOCS_AGENT_RUN_TEST_SCENARIOS: "1",
      DOCS_AGENT_APPROVAL_TEST_SCENARIOS: "1",
      DOCS_AGENT_ASSURANCE_TEST_SCENARIOS: "1",
      DOCS_AGENT_BEHAVIOR_TEST_SCENARIOS: "1",
      DOCS_AGENT_SIGNAL_TEST_SCENARIOS: "1",
    },
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: "auth-setup",
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: "desktop",
      dependencies: ["auth-setup"],
      testIgnore: /auth\.setup\.ts/,
      use: {
        storageState: authState,
        viewport: { width: 1280, height: 800 },
      },
    },
    {
      name: "mobile",
      dependencies: ["auth-setup"],
      testIgnore: /auth\.setup\.ts/,
      testMatch: /shell\.spec\.ts/,
      use: {
        storageState: authState,
        viewport: { width: 390, height: 844 },
      },
    },
  ],
});

export { authState };
