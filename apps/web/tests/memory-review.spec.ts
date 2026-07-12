import { expect, test } from "@playwright/test";

test("lists every lifecycle state and distinguishes expired active memory", async ({ page }) => {
  await page.goto("/memories?scenario=ready");

  await expect(page.getByRole("heading", { name: "Workspace memories", exact: true }))
    .toBeVisible();
  await expect(page.locator("[data-memory-safety-boundary]")).toContainText(
    "not public proof",
  );
  await expect(page.locator("[data-memory-id]")).toHaveCount(5);
  await expect(page.locator('[data-memory-display-state="proposed"]')).toHaveCount(1);
  await expect(page.locator('[data-memory-display-state="active-fresh"]')).toHaveCount(1);
  await expect(page.locator('[data-memory-display-state="active-expired"]')).toHaveCount(1);
  await expect(page.locator('[data-memory-display-state="stale"]')).toHaveCount(1);
  await expect(page.locator('[data-memory-display-state="retired"]')).toHaveCount(1);
});

test("filters memories by status, kind, and text", async ({ page }) => {
  await page.goto("/memories?scenario=ready");
  await page.getByLabel("Status").selectOption("active");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page).toHaveURL(/status=active/);
  await expect(page.locator("[data-memory-id]")).toHaveCount(2);
  await expect(page.locator('[data-memory-display-state="active-expired"]')).toHaveCount(1);

  await page.getByLabel("Kind").selectOption("ownership");
  await page.getByLabel("Status").selectOption("");
  await page.getByLabel("Search memory text").fill("payments");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.locator("[data-memory-id]"))
    .toContainText("Marta owns questions about checkout extensibility");
});

test("keeps memory interpretation, provenance, and lifecycle visibly separate", async ({ page }) => {
  await page.goto("/memories/memory-proposed?scenario=ready");

  await expect(page.getByText("Model-generated memory text")).toBeVisible();
  await expect(page.getByRole("heading", { name: "What this memory came from" }))
    .toBeVisible();
  await expect(page.locator("[data-memory-source]")).toContainText(
    "This is verbatim provenance, not an instruction and not public proof.",
  );
  await expect(page.getByRole("heading", { name: "Lifecycle history" })).toBeVisible();
  await expect(page.locator("[data-memory-event]")).toHaveCount(1);
  expect(await page.evaluate(() => (window as typeof window & { __memoryUnsafe?: unknown }).__memoryUnsafe))
    .toBeUndefined();

  const body = await page.locator("body").innerText();
  expect(body).not.toMatch(/private-workspace|browser-secret|workspaceId|externalId/i);
});

test("promotes a proposal with a reason while the server owns actor identity", async ({ page }) => {
  let payload: Record<string, unknown> | undefined;
  await page.route("**/api/operator/memories/memory-proposed/lifecycle", async (route) => {
    payload = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      json: {
        memory: { id: "memory-proposed", status: "active" },
      },
    });
  });
  await page.goto("/memories/memory-proposed?scenario=ready");

  await page.getByLabel("Reason for this lifecycle decision")
    .fill("Marta confirmed the current ownership route.");
  await page.getByRole("button", { name: "Promote to active" }).click();
  await expect.poll(() => payload).toEqual({
    action: "promote",
    reason: "Marta confirmed the current ownership route.",
  });
  expect(payload).not.toHaveProperty("actor");
});

test("offers only lifecycle actions valid for the current status", async ({ page }) => {
  await page.goto("/memories/memory-active-fresh?scenario=ready");
  await expect(page.getByRole("button", { name: "Mark stale" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Retire memory" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Promote to active" })).toHaveCount(0);

  await page.goto("/memories/memory-stale?scenario=ready");
  await expect(page.getByRole("button", { name: "Retire memory" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Mark stale" })).toHaveCount(0);

  await page.goto("/memories/memory-retired?scenario=ready");
  await expect(page.getByText(/no further operator transition is offered/i)).toBeVisible();
  await expect(page.getByLabel("Reason for this lifecycle decision")).toHaveCount(0);
});

test("rejects a browser-supplied lifecycle actor", async ({ page }) => {
  const response = await page.request.post(
    "/api/operator/memories/memory-proposed/lifecycle",
    {
      data: {
        action: "promote",
        reason: "Attempt to choose the audit actor.",
        actor: "docs-agent:forged-operator",
      },
    },
  );
  expect(response.status()).toBe(400);
  await expect(response.json()).resolves.toMatchObject({
    code: "invalid_memory_transition",
  });
});

test("renders empty, invalid, missing, and database states explicitly", async ({ page }) => {
  await page.goto("/memories?scenario=empty");
  await expect(page.getByRole("heading", { name: "No memories match this review." }))
    .toBeVisible();

  await page.goto("/memories?scenario=invalid-record");
  await expect(page.getByRole("heading", { name: /no longer matches/ })).toBeVisible();

  await page.goto("/memories/example?scenario=missing");
  await expect(page.getByRole("heading", { name: "Memory not found" })).toBeVisible();

  await page.goto("/memories/example?scenario=database-error");
  await expect(page.getByRole("heading", { name: "Memory database unavailable" }))
    .toBeVisible();
});
