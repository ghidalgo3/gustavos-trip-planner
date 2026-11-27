import { test, expect } from "@playwright/test";
import fixtures from "./fixtures.json" with { type: "json" };
import { calendarActivities } from "../src/test/activityCalendarFixture";

for (const width of [320, 390, 1280]) {
  for (const colorScheme of ["light", "dark"] as const) {
    test.describe(`overview layout at ${width}px in ${colorScheme}`, () => {
      test.use({
        viewport: { width, height: 844 },
        colorScheme,
        serviceWorkers: "block",
      });

      test("aligns controls and flight cards and shares scrollable status colors", async ({
        page,
        request,
      }, testInfo) => {
        await request.post("/__test/session", {
          data: { authenticated: true },
        });
        const prefix = `/trips/${fixtures.trip.id}`;
        await page.route(`**${prefix}/document`, async (route) => {
          const response = await route.fetch();
          const document = await response.json();
          calendarActivities.forEach((activity, index) => {
            document.itinerary.items.push({
              ...activity.properties,
              state: ["Maybe", "Yes", "No"][index],
              id: activity.id,
              kind: "activity",
              type: "task",
              busy: false,
              destinationId: fixtures.destination.id,
              estimatedDuration: activity.properties.duration,
            });
          });
          await route.fulfill({ json: document });
        });
        await page.goto(prefix);
        const card = page.locator(".overview-destination").first();
        const dates = card.getByRole("button", { name: /^Edit dates:/ });
        const stay = card.getByRole("button", { name: /Choose stay/ });
        await expect(dates).toBeVisible();
        const datesBox = (await dates.boundingBox())!;
        const stayBox = (await stay.boundingBox())!;
        expect(datesBox.x).toBe(stayBox.x);
        expect(datesBox.width).toBe(stayBox.width);
        expect(datesBox.width).toBeGreaterThan(datesBox.height);
        expect(stayBox.height).toBeGreaterThanOrEqual(44);
        const cardBox = (await card.boundingBox())!;
        const flights = page.locator(".overview-flight-spacer");
        await expect(flights.first()).toHaveAttribute("data-selected", "true");
        await expect(flights.last()).toHaveAttribute("data-selected", "false");
        for (const flight of await flights.all()) {
          const flightBox = (await flight.boundingBox())!;
          expect(flightBox.x).toBe(cardBox.x);
          expect(flightBox.width).toBe(cardBox.width);
        }
        await expect(flights.first()).toHaveCSS("border-top-style", "solid");
        await expect(
          flights.first().getByRole("img", { name: "Flight not selected" }),
        ).toHaveCount(0);
        await expect(flights.last()).toHaveCSS("border-top-style", "dashed");
        await expect(
          flights.last().getByRole("img", { name: "Flight not selected" }),
        ).toBeVisible();
        await expect(
          page.getByRole("button", { name: /^Plans for/ }),
        ).toHaveCount(0);
        await expect(page.locator(".trip-navigation")).toHaveCount(0);

        const pills = card.locator(".overview-activity-tags");
        await expect(pills.getByRole("link")).toHaveCount(3);
        const layout = await pills.evaluate((element) => ({
          tops: [...element.children].map(
            (child) => child.getBoundingClientRect().top,
          ),
          overflows: element.scrollWidth > element.clientWidth,
        }));
        expect(new Set(layout.tops).size).toBe(1);
        if (width < 600) {
          expect(layout.overflows).toBe(true);
          await pills.hover();
          await page.mouse.wheel(600, 0);
          await expect
            .poll(() => pills.evaluate((element) => element.scrollLeft))
            .toBeGreaterThan(0);
        }
        await page.mouse.move(0, 0);
        await pills.evaluate((element) => {
          element.scrollLeft = 0;
        });
        const colors = await pills.getByRole("link").evaluateAll((elements) =>
          elements.map((element) => ({
            foreground: getComputedStyle(element).color,
            background: getComputedStyle(element).backgroundColor,
            border: getComputedStyle(element).borderTopColor,
          })),
        );
        const channels = colors.map(({ foreground }) =>
          foreground.match(/\d+/g)!.map(Number),
        );
        expect(channels[0][2]).toBeGreaterThan(channels[0][0]);
        expect(channels[1][1]).toBeGreaterThan(channels[1][0]);
        expect(channels[1][1]).toBeGreaterThan(channels[1][2]);
        expect(channels[2][0]).toBeGreaterThan(channels[2][1]);
        expect(channels[2][0]).toBeGreaterThan(channels[2][2]);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await page.screenshot({
          path: testInfo.outputPath("overview-layout.png"),
          fullPage: true,
        });

        await page.goto(`${prefix}/activities`);
        const filters = page.getByRole("group", {
          name: "Filter activities by status",
        });
        await expect(filters.getByRole("button")).toHaveCount(3);
        for (const [index, filter] of (
          await filters.getByRole("button").all()
        ).entries()) {
          await expect(filter).toHaveAttribute("aria-pressed", "true");
          await expect(filter).toHaveCSS("color", colors[index].foreground);
          await expect(filter).toHaveCSS(
            "background-color",
            colors[index].background,
          );
          await expect(filter).toHaveCSS(
            "border-top-color",
            colors[index].border,
          );
        }
        await page.screenshot({
          path: testInfo.outputPath("activity-status-colors.png"),
          fullPage: true,
        });
      });
    });
  }
}

for (const width of [320, 390, 1280]) {
  test.describe(`trip overview at ${width}px`, () => {
    test.use({ viewport: { width, height: 844 }, serviceWorkers: "block" });

    for (const offline of [false, true]) {
      test(`opens contextual links and Share from Overview (offline: ${offline})`, async ({
        page,
        request,
        context,
      }, testInfo) => {
        await request.post("/__test/session", {
          data: { authenticated: true },
        });
        const overviewPath = `/trips/${fixtures.trip.id}`;
        await page.route(`**${overviewPath}/document`, async (route) => {
          const response = await route.fetch();
          const document = await response.json();
          document.name = "Amsterdam Trip VERY LONG TRIP NAME LMAOOOOOOOOOOOOO";
          document.places.push({
            id: "versailles",
            name: "Versailles",
            type: "Place",
            destinationId: "versailles",
            countryCode: "FR",
            timeZone: "Europe/Paris",
            active: true,
            etag: "1",
            activitiesEtag: "1",
            location: { type: "Point", coordinates: [2.13, 48.8] },
          });
          document.itinerary.items.push({
            id: "versailles-visit",
            order: 1,
            kind: "visit",
            type: "event",
            name: "Versailles",
            busy: false,
            start: "2030-04-10",
            end: "2030-04-15",
            destinationId: "versailles",
            placeId: "versailles",
          });
          document.preferences.destinations.push({
            destinationId: "versailles",
            constraints: {},
            activities: { instructions: "", defaults: null },
            schedule: {},
          });
          await route.fulfill({ json: document });
        });
        await page.goto(overviewPath);
        const share = page.getByRole("button", { name: "Share", exact: true });
        await expect(share).toBeVisible();
        await expect(page.locator(".app-footer")).toHaveCount(0);
        await expect(
          page.getByRole("navigation", { name: "Trip pages" }),
        ).toHaveCount(0);
        const destinationCard = page.locator(".overview-destination").first();
        const destinationLink = destinationCard.locator(
          ".overview-destination-link",
        );
        await expect(destinationLink).toBeVisible();
        await expect(
          destinationCard.getByRole("heading").getByRole("link"),
        ).toHaveCount(0);
        await expect(
          destinationCard.getByRole("link", {
            name: "Day details",
            exact: true,
          }),
        ).toHaveCount(0);
        if (offline) await context.setOffline(true);
        await page.screenshot({
          path: testInfo.outputPath("overview-navigation.png"),
        });
        for (const [name, section] of [
          ["Activities", "activities"],
          ["Party", "party"],
        ]) {
          const link = section === "party" ? share : destinationLink;
          if (section === "activities" && !offline)
            await link.click({ position: { x: 8, y: 8 } });
          else {
            await link.focus();
            await link.press("Enter");
          }
          await expect(page).toHaveURL(
            new RegExp(`${overviewPath}/${section}(\\?.*)?$`),
          );
          await expect(share).toHaveCount(0);
          await expect(page.locator(".trip-navigation")).toHaveCount(0);
          const breadcrumb = page.getByRole("navigation", {
            name: "Breadcrumb",
          });
          await expect(breadcrumb.locator('[aria-current="page"]')).toHaveText(
            name,
          );
          const title = (await page
            .getByRole("heading", { level: 1 })
            .boundingBox())!;
          const dates = (await page
            .locator(".trip-page-header .trip-date-summary")
            .boundingBox())!;
          const navigation = (await breadcrumb.boundingBox())!;
          expect(dates.y).toBeGreaterThanOrEqual(title.y + title.height);
          if (section !== "activities" || width < 1100) {
            expect(navigation.y).toBeGreaterThanOrEqual(dates.y + dates.height);
          }
          if (section === "activities") {
            const destinations = page.getByRole("tablist", {
              name: "Destinations",
              exact: true,
            });
            const destination = destinations.getByRole("tab", {
              name: /Tokyo/,
            });
            const versailles = destinations.getByRole("tab", {
              name: /Versailles/,
            });
            await expect(destination).toBeVisible();
            await expect(destination.locator(".city-icon")).toBeAttached();
            await expect(versailles.locator(".city-icon")).toHaveCount(0);
            const destinationName =
              ".fui-Tab__content .activity-tab-title strong";
            const tokyoName = await destination
              .locator(destinationName)
              .boundingBox();
            const versaillesName = await versailles
              .locator(destinationName)
              .boundingBox();
            expect(versaillesName!.y).toBeCloseTo(tokyoName!.y);
            const tab = (await destination.boundingBox())!;
            await expect(
              destination.locator(".country-flag").first(),
            ).toBeVisible();
            await expect(
              page.locator(".trip-page-header .country-flag"),
            ).toHaveCount(0);
            if (width >= 1100) {
              const topbar = page.locator(".topbar");
              await expect(
                topbar.getByRole("navigation", { name: "Breadcrumb" }),
              ).toBeVisible();
              const brand = (await topbar
                .getByRole("link", { name: /Trip Planner/ })
                .boundingBox())!;
              expect(navigation.x).toBeGreaterThanOrEqual(
                brand.x + brand.width,
              );
              expect(tab.x).toBeGreaterThanOrEqual(title.x + title.width);
              expect(tab.y).toBeLessThan(dates.y + dates.height);
              expect(tab.height).toBeLessThanOrEqual(76);
            } else {
              expect(tab.y).toBeGreaterThanOrEqual(
                navigation.y + navigation.height,
              );
            }
          }
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          ).toBe(true);
          await page.screenshot({
            path: testInfo.outputPath(`${section}-breadcrumb.png`),
          });
          await breadcrumb
            .getByRole("link", { name: "Overview", exact: true })
            .click();
          await expect(page).toHaveURL(overviewPath);
          await expect(share).toBeVisible();
        }
      });
    }

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
      const border = await card.evaluate(
        (element) => getComputedStyle(element).borderColor,
      );
      await card.hover({ position: { x: 8, y: 8 } });
      await expect
        .poll(() =>
          card.evaluate((element) => getComputedStyle(element).borderColor),
        )
        .not.toBe(border);
      expect(
        await card.evaluate(
          (element) => getComputedStyle(element).backgroundColor,
        ),
      ).toBe(background);

      for (const control of [
        card.getByRole("button", { name: /^Delete destination:/ }),
        card.getByRole("button", { name: /^Edit dates:/ }),
        card.getByRole("button", { name: /Choose stay/ }),
        card.getByRole("link", { name: /^Plan activities in/ }),
      ]) {
        const controlBackground = await control.evaluate(
          (element) => getComputedStyle(element).backgroundColor,
        );
        const isButton = await control.evaluate(
          (element) => element.tagName === "BUTTON",
        );
        await control.hover();
        if (isButton) {
          await expect
            .poll(() =>
              control.evaluate(
                (element) => getComputedStyle(element).backgroundColor,
              ),
            )
            .not.toBe(controlBackground);
        }
        await expect
          .poll(() =>
            card.evaluate((element) => getComputedStyle(element).borderColor),
          )
          .toBe(border);
        await expect
          .poll(() =>
            card.evaluate(
              (element) => getComputedStyle(element).backgroundColor,
            ),
          )
          .toBe(background);
      }

      await expect(
        card.getByRole("button", { name: /^Plans for/ }),
      ).toHaveCount(0);

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
