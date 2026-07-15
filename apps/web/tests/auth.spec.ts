import { expect, test } from "@playwright/test";

test("an approved GitHub identity survives navigation and session restore", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  if (testInfo.project.name === "desktop") {
    await expect(page.getByText("Test Operator", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("@testoperator", { exact: true }).first()).toBeVisible();
  }
  await expect(page.getByText("Authenticated", { exact: true })).toBeVisible();

  const firstIdentity = await page.request.get("/api/operator/whoami");
  expect(firstIdentity.status()).toBe(200);
  await expect(firstIdentity.json()).resolves.toMatchObject({
    principal: {
      id: "docs-agent:github:1001",
      githubAccountId: "1001",
      githubLogin: "testoperator",
      displayName: "Test Operator",
      authMethod: "test",
    },
  });

  await page.getByRole("link", { name: "Status", exact: true }).click();
  await page.reload();
  const restoredIdentity = await page.request.get("/api/operator/whoami");
  expect(await restoredIdentity.json()).toEqual(await firstIdentity.json());
});

test("unauthenticated pages redirect to sign in and protected operations reject", async ({
  page,
}) => {
  await page.context().clearCookies();

  await page.goto("/signals?state=open");
  await expect(page).toHaveURL(/\/sign-in\?returnTo=%2Fsignals%3Fstate%3Dopen$/);
  await expect(page.getByRole("heading", { name: "Sign in to Paige" }))
    .toBeVisible();

  await page.goto("/runs");
  await expect(page).toHaveURL(/\/sign-in\?returnTo=%2Fruns$/);

  await page.goto("/sources");
  await expect(page).toHaveURL(/\/sign-in\?returnTo=%2Fsources$/);

  await page.goto("/capabilities");
  await expect(page).toHaveURL(/\/sign-in\?returnTo=%2Fcapabilities$/);

  await page.goto("/settings");
  await expect(page).toHaveURL(/\/sign-in\?returnTo=%2Fsettings$/);

  const operation = await page.request.get("/api/operator/whoami");
  expect(operation.status()).toBe(401);
  await expect(operation.json()).resolves.toMatchObject({
    code: "operator_unauthorized",
  });
  expect((await page.request.post("/api/operator/workspace-setup/validate", {
    data: { repositoryUrl: "https://github.com/example/docs" },
  })).status()).toBe(401);
  expect((await page.request.post("/api/operator/memories/example/lifecycle", {
    data: { action: "promote", reason: "Unauthorized mutation." },
  })).status()).toBe(401);
  expect((await page.request.post("/api/operator/approvals/example/decision", {
    data: { decision: "approve", reason: "Unauthorized.", idempotencyKey: "unauthorized" },
  })).status()).toBe(401);
  expect((await page.request.post("/api/operator/behavior-settings", {
    data: { settings: defaultSettingsForUnauthorizedRequest() },
  })).status()).toBe(401);
});

function defaultSettingsForUnauthorizedRequest() {
  return {
    personality: {
      responseDepth: "adaptive",
      directness: "balanced",
      warmth: "warm",
      pushback: "reader-advocate",
      uncertaintyStyle: "ask-when-blocked",
    },
    participation: {
      slackEntry: "mentions-and-dms",
      slackContinuation: "relevant-only",
    },
  };
}

test("sign in uses GitHub OAuth state in an HttpOnly cookie", async ({ page }) => {
  await page.context().clearCookies();
  await page.goto("/sign-in");

  const authorization = page.waitForRequest(
    (request) => request.url().startsWith("https://github.com/login/oauth/authorize"),
  );
  await page.route("https://github.com/login/oauth/authorize**", (route) => route.abort());
  await page.getByRole("button", { name: "Continue with GitHub" }).click();
  const request = await authorization;
  expect(new URL(request.url()).searchParams.get("state")).toBeTruthy();

  const cookies = await page.context().cookies();
  const stateCookie = cookies.find((cookie) => cookie.name.includes("state"));
  expect(stateCookie).toMatchObject({ httpOnly: true, sameSite: "Lax" });
});

test("invalid OAuth state is rejected before a GitHub callback can sign in", async ({
  page,
}) => {
  await page.context().clearCookies();
  const response = await page.request.get(
    "/api/auth/callback/github?code=fake-code&state=invalid-state",
    { maxRedirects: 0 },
  );

  expect(response.status()).toBeGreaterThanOrEqual(300);
  expect(response.status()).toBeLessThan(500);
  expect(response.headers().location).toContain("/forbidden");
});

test("a session is forbidden when its GitHub login is no longer approved", async ({
  page,
}) => {
  await page.context().clearCookies();
  const created = await page.request.post("/api/test-auth/session", {
    data: {
      githubId: "2002",
      githubLogin: "intruder",
      displayName: "Unapproved Operator",
    },
  });
  expect(created.status()).toBe(200);

  const pageResponse = await page.goto("/status");
  expect(pageResponse?.status()).toBe(403);
  const operation = await page.request.get("/api/operator/whoami");
  expect(operation.status()).toBe(403);
});

test("operator identity cannot be changed through Better Auth endpoints", async ({
  page,
}) => {
  const response = await page.request.post("/api/auth/update-user", {
    data: { name: "Different Operator" },
  });
  expect(response.status()).toBe(403);

  const identity = await page.request.get("/api/operator/whoami");
  await expect(identity.json()).resolves.toMatchObject({
    principal: {
      id: "docs-agent:github:1001",
      githubLogin: "testoperator",
      displayName: "Test Operator",
    },
  });
});

test("logout and expiration both recover through the sign-in page", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  expect((await page.request.get("/api/operator/whoami")).status()).toBe(401);

  const expired = await page.request.post("/api/test-auth/session", {
    data: {
      githubId: "3003",
      githubLogin: "testoperator",
      displayName: "Expired Operator",
      expired: true,
    },
  });
  expect(expired.status()).toBe(200);
  await page.goto("/status");
  await expect(page).toHaveURL(/\/sign-in\?returnTo=%2Fstatus$/);
});

test("public signup is unavailable", async ({ page }) => {
  await page.context().clearCookies();
  const response = await page.request.post("/api/auth/sign-up/email", {
    data: {
      email: "public@example.test",
      name: "Public User",
      password: "not-a-real-password",
    },
  });
  expect(response.status()).toBe(400);
  await expect(response.json()).resolves.toMatchObject({
    code: "EMAIL_PASSWORD_SIGN_UP_DISABLED",
  });
});
