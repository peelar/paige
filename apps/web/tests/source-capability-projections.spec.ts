import { expect, test } from "@playwright/test";

test("shows configured source readiness, evidence, revision, and authority", async ({ page }) => {
  await page.goto("/sources");
  await expect(page.getByRole("heading", { name: "Knowledge sources", exact: true })).toBeVisible();
  const working = page.locator('[data-source-id="working-documentation"]');
  const watched = page.locator('[data-source-id="watched:saleor"]');
  await expect(working).toContainText("Current Documentation");
  await expect(working).toContainText("Draft target");
  await expect(working).toContainText("Resolved revision");
  await expect(watched).toContainText("Read only");
  await expect(watched).toContainText("Pending verified read");
  await expect(watched).toContainText("cannot reach drafting or publication");
  await expect(page.locator("form")).toHaveCount(0);
  expect(await page.locator("body").innerText()).not.toMatch(/workspaceId|sandboxPath|token|secret/i);
});

test("explains effective capability families by verified principal class", async ({ page }) => {
  await page.goto("/capabilities");
  await expect(page.getByRole("heading", { name: "Capabilities", exact: true })).toBeVisible();
  const eve = page.locator('[data-capability-context="eve"]');
  const watch = page.locator('[data-capability-context="watch"]');
  await expect(eve.locator('[data-capability-family="draft.edit"]')).toHaveAttribute("data-capability-availability", "available");
  await expect(eve.locator('[data-capability-family="provider.deliver"]')).toHaveAttribute("data-capability-availability", "unavailable");
  await expect(watch.locator('[data-capability-family="knowledge.read"]')).toHaveAttribute("data-capability-availability", "conditional");
  await expect(watch.locator('[data-capability-family="publication.publish"]')).toHaveAttribute("data-capability-availability", "unavailable");
  await expect(watch).toContainText("exact active effective revision");
  await expect(page.getByText("Visibility is not authorization")).toBeVisible();
  await expect(page.locator("form")).toHaveCount(0);
});

test("source and capability projection failures stay explicit", async ({ page }) => {
  await page.goto("/sources?scenario=unconfigured");
  await expect(page.getByRole("heading", { name: "No sources configured" })).toBeVisible();
  await page.goto("/sources?scenario=invalid-record");
  await expect(page.getByRole("heading", { name: "Invalid source projection" })).toBeVisible();
  await page.goto("/capabilities?scenario=database-error");
  await expect(page.getByRole("heading", { name: "Capability data unavailable" })).toBeVisible();
});
