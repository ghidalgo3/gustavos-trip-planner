import { test, expect, type Locator, type Page } from "@playwright/test";
import fixtures from "./fixtures.json" with { type: "json" };
import { calendarActivities } from "../src/test/activityCalendarFixture";

async function cardColors(card: Locator) {
  return card.evaluate((element) => ({
    background: getComputedStyle(element).backgroundColor,
    border: getComputedStyle(
      element,
      element.classList.contains("fui-Card") ? "::after" : null,
    ).borderColor,
  }));
}

async function expectCardHover(page: Page, card: Locator, control?: Locator) {
  await expect(card).toBeVisible();
  await page.mouse.move(0, 0);
  const initial = await cardColors(card);
  await card.hover({ position: { x: 8, y: 8 } });
  await expect
    .poll(async () => (await cardColors(card)).border)
    .not.toBe(initial.border);
  expect((await cardColors(card)).background).toBe(initial.background);
  if (control) {
    await control.hover();
    await expect.poll(() => cardColors(card)).toEqual(initial);
  }
}

for (const width of [390, 1280]) {
  for (const colorScheme of ["light", "dark"] as const) {
    test.describe(`card hover at ${width}px in ${colorScheme} mode`, () => {
      test.use({
        viewport: { width, height: 844 },
        colorScheme,
        serviceWorkers: "block",
      });

      test("cards highlight their full borders and isolate their inner controls", async ({
        page,
        request,
      }) => {
        await request.post("/__test/session", {
          data: { authenticated: true, selection: "partial" },
        });
        await page.goto("/");
        const trip = page.locator(".trip-card").first();
        await expectCardHover(
          page,
          trip,
          trip.getByRole("button", { name: /^Options for/ }),
        );

        const prefix = `/trips/${fixtures.trip.id}`;
        await page.route(`**${prefix}/document`, async (route) => {
          const response = await route.fetch();
          const document = await response.json();
          const activity = calendarActivities[0];
          document.places.push({
            id: activity.id,
            name: activity.properties.name,
            type: "Place",
            location: activity.geometry,
          });
          document.itinerary.items.push({
            ...activity.properties,
            id: activity.id,
            kind: "activity",
            type: "task",
            busy: false,
            destinationId: fixtures.destination.id,
            placeId: activity.id,
            estimatedDuration: activity.properties.duration,
            address: "Museum street",
          });
          await route.fulfill({ json: document });
        });

        await page.goto(`${prefix}/activities`);
        const activity = page.locator(".activity-list-item").first();
        const state = activity.getByRole("button", { name: /^Status for/ });
        await expectCardHover(page, activity, state);
        const initial = await cardColors(activity);
        const title = (await activity
          .locator(".activity-list-title")
          .boundingBox())!;
        await page.mouse.move(
          title.x + title.width / 2,
          title.y + title.height / 2,
        );
        await expect
          .poll(async () => (await cardColors(activity)).border)
          .not.toBe(initial.border);
        expect((await cardColors(activity)).background).toBe(
          initial.background,
        );
        expect(
          await activity
            .locator(".activity-list-title")
            .evaluate((element) => getComputedStyle(element).backgroundColor),
        ).toBe("rgba(0, 0, 0, 0)");
        await activity.screenshot({
          path: test.info().outputPath("activity-card-hover.png"),
        });
        await state.click();
        await expect(page.getByRole("menu")).toBeVisible();
        await expect(page.getByRole("dialog")).toHaveCount(0);
        await page.keyboard.press("Escape");
        await activity
          .getByRole("button", { name: "Museum", exact: true })
          .focus();
        await page.keyboard.press("Enter");
        await expect(
          page.getByRole("dialog", { name: "Edit activity", exact: true }),
        ).toBeVisible();
        await page.keyboard.press("Escape");

        await page.goto(`${prefix}/flights`);
        const flight = page
          .locator(".flight-grid-card:not(.flight-grid-skeleton)")
          .first();
        await expectCardHover(
          page,
          flight,
          flight.getByText("Flight details", { exact: true }),
        );

        await page.goto(prefix);
        const destination = page.locator(".overview-destination").first();
        await expectCardHover(
          page,
          destination,
          destination.getByRole("button", { name: /^Edit dates:/ }),
        );
        await page.route("**/mapToken", (route) =>
          route.fulfill({
            json: {
              token: "test",
              endpoint: "https://hover-maps.example.test",
              expiresAt: "2099-01-01T00:00:00Z",
            },
          }),
        );
        await page.route("**/search/fuzzy/json?*", (route) =>
          route.fulfill({
            json: {
              results: [
                {
                  id: "hotel",
                  poi: { name: "Tokyo hotel" },
                  address: {
                    freeformAddress: "Hotel street, Tokyo",
                    countryCode: "JP",
                  },
                  position: { lon: 139.76, lat: 35.68 },
                },
              ],
            },
          }),
        );
        await destination.getByRole("button", { name: /Choose stay/ }).click();
        const drawer = page.getByRole("dialog", { name: "Stay in Tokyo" });
        await drawer
          .getByRole("searchbox", { name: "Stay location" })
          .fill("Tokyo hotel");
        await drawer
          .getByRole("button", { name: "Search", exact: true })
          .click();
        const stay = drawer.locator(".place-search-result-button").first();
        await expect(stay).toBeVisible();
        await page.mouse.move(0, 0);
        const stayColors = await cardColors(stay);
        await stay.hover();
        await expect
          .poll(async () => (await cardColors(stay)).background)
          .not.toBe(stayColors.background);
        const hitIsButton = await stay.evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          return Boolean(
            document
              .elementFromPoint(bounds.right - 8, bounds.bottom - 8)
              ?.closest("button"),
          );
        });
        expect(hitIsButton).toBe(true);
      });
    });
  }
}
