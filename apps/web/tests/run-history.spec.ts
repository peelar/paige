import { expect, test } from "@playwright/test";

test("lists active, waiting, failed, completed, and expired product runs", async ({ page }) => {
  await page.goto("/runs?scenario=ready");
  await expect(page.getByRole("heading", { name: "Product runs", exact: true })).toBeVisible();
  await expect(page.getByText("Index, not execution log")).toBeVisible();
  await expect(page.locator("[data-run-id]")).toHaveCount(5);
  for (const state of ["active", "waiting-for-input", "failed", "completed", "expired"]) {
    await expect(page.locator(`[data-run-state="${state}"]`)).toHaveCount(1);
  }
});

test("filters run history by status, type, and stable references", async ({ page }) => {
  await page.goto("/runs?scenario=ready");
  await page.getByLabel("Status").selectOption("waiting-for-input");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.locator("[data-run-id]")).toHaveCount(1);
  await expect(page.locator('[data-run-state="waiting-for-input"]')).toContainText("Human input is required");

  await page.getByLabel("Status").selectOption("");
  await page.getByLabel("Run type").selectOption("docs-verification");
  await page.getByLabel("Search run references").fill("wrun_01J0DOCSAGENT");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.locator("[data-run-id]")).toHaveCount(1);
  await expect(page.locator("[data-run-id]")).toContainText("Document the metadata permission change");
});

test("shows safe steps and links to traces without copying the durable stream", async ({ page }) => {
  await page.goto("/runs/run-completed?scenario=ready");
  await expect(page.getByRole("heading", { name: "Run steps" })).toBeVisible();
  await expect(page.locator("[data-run-step]")).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Execution traces" })).toBeVisible();
  await expect(page.locator('[data-trace-availability="available"]')).toHaveCount(2);
  await expect(page.locator('[data-trace-availability="unavailable"]')).toContainText("does not have access");
  await expect(page.getByRole("link", { name: "Open trace ↗" })).toHaveCount(2);
  await expect(page.getByText("wrun_01J0DOCSAGENT", { exact: true })).toBeVisible();

  const body = await page.locator("body").innerText();
  expect(body).not.toMatch(/private-model-input|private-model-output|ghp_secret|Bearer secret/);
});

test("keeps missing trace access separate from a completed run", async ({ page }) => {
  await page.goto("/runs/run-completed?scenario=ready");
  await expect(page.getByText("Completed", { exact: true }).first()).toBeVisible();
  await expect(page.locator('[data-trace-availability="unavailable"]')).toContainText("Unavailable");
  await expect(page.getByText(/30-day index retention/)).toBeVisible();

  await page.goto("/runs/run-expired?scenario=ready");
  await expect(page.getByText("Expired", { exact: true }).first()).toBeVisible();
});

test("renders unauthorized, missing, invalid, empty, and database states", async ({ page }) => {
  await page.goto("/runs?scenario=empty");
  await expect(page.getByRole("heading", { name: "No runs match this view." })).toBeVisible();
  await page.goto("/runs?scenario=unauthorized");
  await expect(page.getByRole("heading", { name: "Run history is not authorized." })).toBeVisible();
  await page.goto("/runs/example?scenario=missing");
  await expect(page.getByRole("heading", { name: "Run not found" })).toBeVisible();
  await page.goto("/runs/example?scenario=invalid-record");
  await expect(page.getByRole("heading", { name: "Run record is invalid" })).toBeVisible();
  await page.goto("/runs/example?scenario=database-error");
  await expect(page.getByRole("heading", { name: "Run database unavailable" })).toBeVisible();
});
