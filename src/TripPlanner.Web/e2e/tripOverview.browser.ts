import { test, expect } from "@playwright/test";
import fixtures from "./fixtures.json" with { type: "json" };

for (const width of [390, 1280]) {
  test.describe(`trip overview at ${width}px`, () => {
    test.use({ viewport: { width, height: 844 }, serviceWorkers: "block" });

    test("highlights destinations and opens activities without intercepting card controls", async ({
      page,
      request,
    }) => {
      await request.post("/__test/session", { data: { authenticated: true } });
      const overviewPath = `/trips/${fixtures.trip.id}`;
      const activitiesPath = `${overviewPath}/activities?destination=${encodeURIComponent(fixtures.destination.id)}`;
      await page.goto(overviewPath);
      const card = page.locator(".overview-destination-navigable").first();
      const link = card.getByRole("link", {
        name: fixtures.destination.properties.name,
        exact: true,
      });
      await expect(link).toBeVisible();
      const background = await card.evaluate(
        (element) => getComputedStyle(element).backgroundColor,
      );
      await card.hover();
      await expect
        .poll(() =>
          card.evaluate((element) => getComputedStyle(element).backgroundColor),
        )
        .not.toBe(background);

      const plans = card.getByRole("button", { name: /^Plans for/ });
      await plans.click();
      await expect(plans).toHaveAttribute("aria-expanded", "true");
      await expect(page).toHaveURL(new RegExp(`${overviewPath}$`));

      const dates = card.getByRole("button", { name: /^Edit dates:/ });
      await dates.click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`${overviewPath}$`));
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);

      // The padding belongs to the card link, outside its independent controls.
      const box = await card.boundingBox();
      await card.click({ position: { x: box!.width - 8, y: 8 } });
      await expect(page).toHaveURL(activitiesPath);

      await page.goto(overviewPath);
      await link.focus();
      await expect(link).toBeFocused();
      await link.press("Enter");
      await expect(page).toHaveURL(activitiesPath);
    });
  });
}
