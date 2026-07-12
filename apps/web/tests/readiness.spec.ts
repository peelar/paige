import { expect, test } from "@playwright/test";

const scenarios = [
  ["ready", "ready", "Ready to work."],
  ["partial", "attention", "Some paths still need proof."],
  ["unknown", "attention", "Some paths still need proof."],
  ["blocked", "blocked", "A known requirement is blocking work."],
  ["database-down", "blocked", "A known requirement is blocking work."],
  ["provider-down", "blocked", "A known requirement is blocking work."],
] as const;

for (const [scenario, overall, title] of scenarios) {
  test(`renders the ${scenario} readiness report`, async ({ page }) => {
    await page.goto(`/status?scenario=${scenario}`);

    await expect(page.getByRole("heading", { name: "Status", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await expect(page.locator(`[data-readiness-overall="${overall}"]`)).toBeVisible();
    await expect(page.locator("[data-readiness-id]")).toHaveCount(6);
    await expect(page.getByText(/Last checked/)).toBeVisible();
  });
}

test("keeps unknown and reachable provider paths distinct from verified", async ({ page }) => {
  await page.goto("/status?scenario=partial");

  await expect(page.locator('[data-readiness-id="slack"]')).toHaveAttribute(
    "data-readiness-state",
    "reachable",
  );
  await expect(page.locator('[data-readiness-id="linear"]')).toHaveAttribute(
    "data-readiness-state",
    "configured",
  );
  await expect(page.getByText("Mention Paige in Slack and confirm the inbound event.")).toBeVisible();
  const slackStages = page.locator('[data-connector-stages="slack"]');
  await expect(slackStages.locator('[data-connector-stage="connector"]')).toHaveAttribute(
    "data-connector-stage-state",
    "verified",
  );
  await expect(slackStages.locator('[data-connector-stage="trigger"]')).toHaveAttribute(
    "data-connector-stage-state",
    "action-required",
  );
  await expect(slackStages.getByText(/--trigger-path \/eve\/v1\/slack/)).toBeVisible();

  const linearStages = page.locator('[data-connector-stages="linear"]');
  await expect(linearStages.locator('[data-connector-stage="installation"]')).toHaveAttribute(
    "data-connector-stage-state",
    "action-required",
  );
  await expect(linearStages.getByText(/app:assignable and app:mentionable/)).toBeVisible();
});

test("shows repository-targeted GitHub installation state separately", async ({ page }) => {
  await page.goto("/status?scenario=blocked");

  const githubStages = page.locator('[data-connector-stages="github-writeback"]');
  await expect(githubStages.locator('[data-connector-stage="connector"]')).toHaveAttribute(
    "data-connector-stage-state",
    "verified",
  );
  await expect(githubStages.locator('[data-connector-stage="installation"]')).toHaveAttribute(
    "data-connector-stage-state",
    "verified",
  );
  await expect(githubStages.locator('[data-connector-stage="trigger"]')).toHaveAttribute(
    "data-connector-stage-state",
    "not-applicable",
  );
  await expect(githubStages.locator('[data-connector-stage="grant"]')).toHaveAttribute(
    "data-connector-stage-state",
    "action-required",
  );
  await expect(page.getByText(/configured working documentation repository/)).toBeVisible();
});

test("rechecks installation state without leaving onboarding", async ({ page }) => {
  await page.goto("/status?scenario=partial");
  const repository = page.getByLabel("Working documentation repository");
  await repository.fill("https://github.com/example/in-progress-docs");
  const recheck = page.getByRole("button", { name: "Recheck installation" });
  await expect(recheck).toBeVisible();
  await recheck.click();
  await expect(page).toHaveURL(/\/status\?scenario=partial$/);
  await expect(page.locator("[data-workspace-onboarding]")).toBeVisible();
  await expect(repository).toHaveValue("https://github.com/example/in-progress-docs");
});

test("renders actionable database and provider failures without secrets", async ({ page }) => {
  await page.goto("/status?scenario=database-down");
  await expect(page.getByText("Check DOCS_AGENT_DATABASE_URL and run pnpm db:migrate.")).toBeVisible();

  await page.goto("/status?scenario=provider-down");
  await expect(page.getByText("Check the Slack connector installation, then retry.")).toBeVisible();
  await expect(page.getByText("Check the Linear connector installation, then retry.")).toBeVisible();

  const body = await page.locator("body").innerText();
  expect(body).not.toMatch(/xox[baprs]-|lin_api_|github_pat_/i);
  expect(body).not.toMatch(/slack\/docs-agent|linear\/docs-agent|scl_[a-z0-9]+/i);
});
