import { expect, test } from "@playwright/test";

test("the shell navigates and adapts to the viewport", async ({ page }, testInfo) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Keep the story as current as the product." }),
  ).toBeVisible();

  const navigation = page.getByRole("navigation", { name: "Primary" });
  await expect(navigation).toBeVisible();

  await page.getByRole("link", { name: "Status", exact: true }).click();
  await expect(page).toHaveURL(/\/status$/, { timeout: 15_000 });
  await expect(page.getByRole("link", { name: "Status", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByRole("heading", { name: "Status", exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Signals", exact: true }).click();
  await expect(page).toHaveURL(/\/signals$/);
  await expect(page.getByRole("link", { name: "Signals" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByRole("heading", { name: "Signals", exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Memories", exact: true }).click();
  await expect(page).toHaveURL(/\/memories$/);
  await expect(page.getByRole("link", { name: "Memories" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByRole("heading", { name: "Workspace memories", exact: true }))
    .toBeVisible();

  const sidebarBox = await page.locator("[data-shell-sidebar]").boundingBox();
  const mainBox = await page.locator("#main-content").boundingBox();
  expect(sidebarBox).not.toBeNull();
  expect(mainBox).not.toBeNull();

  if (testInfo.project.name === "desktop") {
    expect(sidebarBox!.x + sidebarBox!.width).toBeLessThanOrEqual(mainBox!.x);
    expect(sidebarBox!.height).toBeGreaterThanOrEqual(page.viewportSize()?.height ?? 0);
  } else {
    expect(sidebarBox!.y + sidebarBox!.height).toBeLessThanOrEqual(mainBox!.y);
    expect(sidebarBox!.width).toBeGreaterThanOrEqual(380);
  }
});

test("keyboard users can skip navigation and recover from an unknown route", async ({
  page,
}) => {
  await page.goto("/");
  const skipLink = page.getByRole("link", { name: "Skip to content" });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.keyboard.press("Tab");
    if (await skipLink.evaluate((element) => element === document.activeElement)) break;
  }
  await expect(skipLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();

  await page.goto("/missing-control-plane-route");
  await expect(
    page.getByRole("heading", { name: "There is nothing at this address." }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Return to Status" }).click();
  await expect(page).toHaveURL(/\/status$/);
});

test("essential shell text meets WCAG AA contrast", async ({ page }) => {
  await page.goto("/status");

  const pairs = await Promise.all(
    [page.locator("body"), page.getByRole("link", { name: "Status" })].map(
      async (locator) =>
        locator.evaluate((element) => {
          const style = getComputedStyle(element);
          return {
            background: style.backgroundColor,
            foreground: style.color,
          };
        }),
    ),
  );

  for (const pair of pairs) {
    expect(contrastRatio(pair.foreground, pair.background)).toBeGreaterThanOrEqual(4.5);
  }
});

function contrastRatio(foreground: string, background: string) {
  const foregroundLuminance = relativeLuminance(parseRgb(foreground));
  const backgroundLuminance = relativeLuminance(parseRgb(background));
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);

  return (lighter + 0.05) / (darker + 0.05);
}

function parseRgb(color: string): [number, number, number] {
  const channels = color.match(/[\d.]+/g)?.slice(0, 3).map(Number);
  if (!channels || channels.length !== 3) {
    throw new Error(`Expected an rgb color, received ${color}`);
  }

  return channels as [number, number, number];
}

function relativeLuminance([red, green, blue]: [number, number, number]) {
  const [r, g, b] = [red, green, blue].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
