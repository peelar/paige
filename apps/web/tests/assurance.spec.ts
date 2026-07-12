import { expect, test } from "@playwright/test";

test("lists every assurance outcome and keeps proof types distinct", async ({ page }) => {
  await page.goto("/assurance?scenario=ready");
  await expect(page.getByRole("heading", { name: "Assurance", exact: true })).toBeVisible();
  await expect(page.getByText("Proof, not a test runner")).toBeVisible();
  await expect(page.locator("[data-assurance-run-id]")).toHaveCount(6);
  for (const outcome of ["passed", "failed", "flaky", "skipped", "missing", "expired"]) {
    await expect(page.locator(`[data-assurance-outcome="${outcome}"]`)).toHaveCount(1);
  }
  await expect(page.locator('[data-assurance-kind="live-eval"]')).toHaveCount(4);
  await expect(page.locator('[data-assurance-kind="deterministic-validation"]')).toHaveCount(2);
});

test("filters by proof type, result, and stable runtime identity", async ({ page }) => {
  await page.goto("/assurance?scenario=ready");
  await page.getByLabel("Proof type").selectOption("deterministic-validation");
  await page.getByLabel("Result").selectOption("passed");
  await page.getByLabel("Search assurance records").fill("ac09165");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.locator("[data-assurance-run-id]")).toHaveCount(1);
  await expect(page.locator("[data-assurance-run-id]")).toContainText("pnpm-check");
  await expect(page.locator("[data-assurance-run-id]")).toContainText("Deterministic validation");
});

test("shows safe case evidence, failures, assertions, and product behavior", async ({ page }) => {
  await page.goto("/assurance/live-current?scenario=ready");
  await expect(page.getByRole("heading", { name: "Recorded assurance log" })).toBeVisible();
  await expect(page.locator("[data-assurance-case]")).toHaveCount(3);
  await expect(page.locator('[data-assurance-case-outcome="failed"]')).toContainText("calledTool");
  await expect(page.locator('[data-assertion-passed="false"]')).toContainText("Did not hold");
  await expect(page.getByText("Related product behavior").first()).toBeVisible();
  await expect(page.getByText("eve://evals/docs-impact/patch")).toBeVisible();
  const body = await page.locator("body").innerText();
  expect(body).not.toMatch(/private prompt|private source context|chain of thought|Bearer secret|ghp_secret/i);

  await page.goto("/assurance/fixture%3Aencoded?scenario=ready");
  await expect(page.locator('[data-assurance-detail-state="ready"]')).toBeVisible();
});

test("compares only earlier compatible baselines and exposes weakened proof", async ({ page }) => {
  await page.goto("/assurance/live-current?scenario=ready");
  await expect(page.getByRole("heading", { name: "Baseline comparison" })).toBeVisible();
  await expect(page.locator('[data-comparison-change="regressed"]')).toHaveCount(1);
  await expect(page.locator('[data-comparison-change="weakened"]')).toHaveCount(1);
  await expect(page.getByText(/Removed assertions, softer gates/)).toBeVisible();
  await page.getByLabel("Baseline").selectOption("live-baseline-older");
  await page.getByRole("button", { name: "Compare" }).click();
  await expect(page.getByText("Passed · 827ac31", { exact: true })).toBeVisible();

  await page.goto("/assurance/live-current?scenario=baseline-invalid");
  await expect(page.getByRole("heading", { name: "Baseline is not compatible" })).toBeVisible();
});

test("renders loading, empty, corrupt, unauthorized, missing, and database states", async ({ page }) => {
  await page.goto("/assurance?scenario=loading");
  await expect(page.locator('[data-assurance-list-state="loading"] [aria-label="Loading assurance records"]')).toBeVisible();
  await page.goto("/assurance?scenario=empty");
  await expect(page.getByRole("heading", { name: "No assurance records match." })).toBeVisible();
  await page.goto("/assurance?scenario=invalid-record");
  await expect(page.getByRole("heading", { name: "A validation record is corrupt." })).toBeVisible();
  await page.goto("/assurance?scenario=unauthorized");
  await expect(page.getByRole("heading", { name: "Assurance is not authorized." })).toBeVisible();
  await page.goto("/assurance/example?scenario=missing");
  await expect(page.getByRole("heading", { name: "Validation run not found" })).toBeVisible();
  await page.goto("/assurance/example?scenario=database-error");
  await expect(page.getByRole("heading", { name: "Assurance database unavailable" })).toBeVisible();
});

test("the assurance route remains behind operator authentication", async ({ page }) => {
  await page.context().clearCookies();
  await page.goto("/assurance");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fassurance|\/sign-in/);
  await expect(page.getByRole("heading", { name: /Sign in/i })).toBeVisible();
});
