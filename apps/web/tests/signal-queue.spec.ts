import { expect, test } from "@playwright/test";

test("shows open signals in deterministic triage order without source internals", async ({ page }) => {
  await page.goto("/signals?scenario=ready");

  const rows = page.locator("[data-signal-id]");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toHaveAttribute("data-signal-id", "signal-release-verification");
  await expect(rows.nth(1)).toHaveAttribute("data-signal-id", "signal-linear-metadata");
  await expect(rows.nth(2)).toHaveAttribute("data-signal-id", "signal-slack-checkout");
  await expect(page.getByText("Priority high to low. Newest update breaks ties; stable ids resolve exact ties.")).toBeVisible();

  const body = await page.locator("body").innerText();
  expect(body).not.toContain("signal-closed-limit");
  expect(body).not.toMatch(/sourceText|providerId|credential|lin_api_|xox[baprs]-|github_pat_/i);
});

test("filters by current status and source kind", async ({ page }) => {
  await page.goto("/signals?scenario=ready&status=docs-verified&source=linear-issue");

  await expect(page.locator("[data-signal-id]")).toHaveCount(1);
  await expect(page.locator('[data-signal-id="signal-linear-metadata"]')).toBeVisible();
  await expect(page.getByLabel("Status")).toHaveValue("docs-verified");
  await expect(page.locator('select[name="source"]')).toHaveValue("linear-issue");
});

test("includes closed work only when requested", async ({ page }) => {
  await page.goto("/signals?scenario=ready&scope=all");

  await expect(page.locator("[data-signal-id]")).toHaveCount(4);
  await expect(page.locator('[data-signal-id="signal-closed-limit"]')).toHaveAttribute(
    "data-signal-status",
    "closed-already-covered",
  );
  await expect(page.getByLabel("Include closed")).toBeChecked();
});

test("renders the empty queue and filtered-empty recovery", async ({ page }) => {
  await page.goto("/signals?scenario=empty");
  await expect(page.getByRole("heading", { name: "No open docs signals are waiting." })).toBeVisible();

  await page.goto("/signals?scenario=ready&status=patch-failed");
  await expect(page.getByRole("heading", { name: "No signals match these filters." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Reset filters" })).toBeVisible();
});

test("renders an actionable database failure", async ({ page }) => {
  await page.goto("/signals?scenario=database-error");

  await expect(page.locator('[data-signal-error="database-error"]')).toBeVisible();
  await expect(page.getByRole("heading", { name: "The work queue cannot be read." })).toBeVisible();
  await expect(page.getByText(/DOCS_AGENT_DATABASE_URL/)).toBeVisible();
});

test("stops visibly on an invalid persisted signal", async ({ page }) => {
  await page.goto("/signals?scenario=invalid-record");

  await expect(page.locator('[data-signal-error="invalid-record"]')).toBeVisible();
  await expect(page.getByRole("heading", { name: "One signal does not fit the queue contract." })).toBeVisible();
  await expect(page.getByText(/will not silently omit it/)).toBeVisible();
});
