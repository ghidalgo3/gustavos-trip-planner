import { test, expect } from "@playwright/test";

test("the footer opens notices when signed out and the page reloads offline", async ({
  browser,
  request,
}, testInfo) => {
  await request.post("/__test/session", { data: { authenticated: false } });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  try {
    const page = await context.newPage();
    await page.goto("http://127.0.0.1:4174/");
    await expect(
      page.getByRole("link", { name: "Sign in with Google" }),
    ).toBeVisible();
    await page
      .locator("footer")
      .getByRole("link", { name: "Notices", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Notices", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "City Icons", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", {
        name: "Third-party software licenses",
        exact: true,
      }),
    ).toBeVisible();
    const city = page.getByRole("listitem").filter({
      has: page.getByRole("link", { name: "City Icons", exact: true }),
    });
    await expect(
      city.getByText(/^City Icons by Studio Partdirector/),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
    await page.screenshot({ path: testInfo.outputPath("notices-mobile.png") });
    await expect
      .poll(() =>
        page.evaluate(
          async () =>
            !!(await caches.match("/index.html", {
              cacheName: "tripplanner-shell-v2",
            })),
        ),
      )
      .toBe(true);
    await context.setOffline(true);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Notices", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("link", { name: "Third-party software licenses", exact: true })
      .click();
    await expect(page.locator("body")).toContainText("Flagpack");
    await expect(page.locator("body")).toContainText(
      "Copyright (c) 2021 Yummygum",
    );
    await expect(page.locator("body")).toContainText("react");
  } finally {
    await context.close();
  }
});
