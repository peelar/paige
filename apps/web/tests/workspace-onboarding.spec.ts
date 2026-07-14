import { expect, test } from "@playwright/test";

const passedValidation = {
  readyForPersistence: true,
  input: {
    repositoryUrl: "https://github.com/example/new-docs",
    ref: "main",
    githubConnector: "github/docs-agent",
    watchedRepositories: [{
      repositoryUrl: "https://github.com/example/product",
      importance: "medium",
      defaultRef: "main",
      pathFilters: [],
      signals: ["releases"],
    }],
    contextRepositories: [{
      repositoryUrl: "https://github.com/example/decisions",
      ref: "main",
      pathFilters: [],
      evidenceClass: "maintainer-confirmed-product-decision",
      canSupportPublicDocsClaim: true,
    }],
  },
  checks: [
    { id: "repository", status: "passed", message: "Repository and main are accessible." },
    { id: "github-writeback", status: "passed", message: "GitHub writeback is ready." },
    { id: "watched-repositories", status: "passed", message: "Read-only policy is intact." },
    { id: "context-repositories", status: "passed", message: "Context policy is intact." },
  ],
} as const;

test("validates before saving and refreshes canonical readiness", async ({ page }) => {
  let savedPayload: Record<string, unknown> | undefined;
  await page.route("**/api/operator/workspace-setup/validate", async (route) => {
    const payload = route.request().postDataJSON() as Record<string, unknown>;
    expect(payload).toMatchObject({
      repositoryUrl: "https://github.com/example/new-docs",
      ref: "main",
      githubConnector: "github/docs-agent",
    });
    await route.fulfill({ json: { validation: passedValidation } });
  });
  await page.route("**/api/operator/workspace-setup", async (route) => {
    savedPayload = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      json: {
        saved: true,
        validation: passedValidation,
        repositoryUrl: "https://github.com/example/new-docs",
      },
    });
  });

  await page.goto("/status?scenario=ready");
  const onboarding = page.locator("[data-workspace-onboarding]");
  await expect(onboarding.getByRole("heading", { name: "Point Paige at the right truth." }))
    .toBeVisible();
  await expect(onboarding.locator('input[name="ref"]')).toHaveValue("main");
  await expect(onboarding.locator('input[name="docsRoot"]')).toHaveValue("");
  await expect(onboarding.getByRole("button", { name: "Save validated setup" }))
    .toHaveCount(0);

  await onboarding.locator('input[name="repositoryUrl"]')
    .fill("https://github.com/example/new-docs");
  await onboarding.locator('textarea[name="watchedRepositories"]')
    .fill("https://github.com/example/product");
  await onboarding.locator('textarea[name="contextRepositories"]')
    .fill("https://github.com/example/decisions");
  await onboarding.getByRole("button", { name: "Validate setup" }).click();

  await expect(onboarding.locator('[data-onboarding-status="passed"]')).toHaveCount(4);
  await expect(onboarding.getByText("Nothing was saved.")).toHaveCount(0);
  const save = onboarding.getByRole("button", { name: "Save validated setup" });
  await expect(save).toBeVisible();
  await save.click();
  await expect(onboarding.getByText(/Workspace setup saved/)).toBeVisible();
  expect(savedPayload).toMatchObject({
    repositoryUrl: "https://github.com/example/new-docs",
    ref: "main",
    watchedRepositories: [{
      repositoryUrl: "https://github.com/example/product",
      importance: "medium",
      defaultRef: "main",
      pathFilters: [],
      signals: ["releases"],
    }],
    contextRepositories: [{
      repositoryUrl: "https://github.com/example/decisions",
      ref: "main",
      pathFilters: [],
      evidenceClass: "maintainer-confirmed-product-decision",
      canSupportPublicDocsClaim: true,
    }],
  });
});

test("keeps failed repository and permission checks visible without persisting", async ({
  page,
}) => {
  let saveRequests = 0;
  await page.route("**/api/operator/workspace-setup/validate", (route) => route.fulfill({
    json: {
      validation: {
        readyForPersistence: false,
        input: passedValidation.input,
        checks: [
          {
            id: "repository",
            status: "blocked",
            message: "GitHub ref was not found: example/new-docs#main.",
          },
          {
            id: "github-writeback",
            status: "blocked",
            message: "The GitHub App lacks required writeback permissions.",
          },
          passedValidation.checks[2],
        ],
      },
    },
  }));
  await page.route("**/api/operator/workspace-setup", (route) => {
    saveRequests += 1;
    return route.fulfill({ status: 500 });
  });

  await page.goto("/status?scenario=blocked");
  const onboarding = page.locator("[data-workspace-onboarding]");
  await onboarding.locator('input[name="repositoryUrl"]')
    .fill("https://github.com/example/new-docs");
  await onboarding.getByRole("button", { name: "Validate setup" }).click();

  await expect(onboarding.locator('[data-onboarding-status="blocked"]')).toHaveCount(2);
  await expect(onboarding.getByText(/ref was not found/)).toBeVisible();
  await expect(onboarding.getByText(/lacks required writeback permissions/)).toBeVisible();
  await expect(onboarding.getByText("Nothing was saved. Resolve the blocked checks and validate again."))
    .toBeVisible();
  await expect(onboarding.getByRole("button", { name: "Save validated setup" }))
    .toHaveCount(0);
  expect(saveRequests).toBe(0);
});
