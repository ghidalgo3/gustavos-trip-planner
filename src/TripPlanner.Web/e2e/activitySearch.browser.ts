import { test, expect } from "@playwright/test";
import fixtures from "./fixtures.json" with { type: "json" };
import { calendarActivities } from "../src/test/activityCalendarFixture";

for (const width of [320, 390, 768, 820, 1024, 1280]) {
  test.describe(`activity search at ${width}px`, () => {
    test.use({ viewport: { width, height: 844 }, serviceWorkers: "block" });

    test.beforeEach(async ({ page, request }) => {
      await request.post("/__test/session", { data: { authenticated: true } });
      const prefix = `/trips/${fixtures.trip.id}`;
      await page.route(`**${prefix}/document`, async (route) => {
        const response = await route.fetch();
        const document = await response.json();
        const museum = calendarActivities[0];
        const activities = [
          museum,
          {
            ...museum,
            id: "search-cafe",
            geometry: null,
            properties: {
              ...museum.properties,
              name: "Harbour café",
              kinds: ["Food & Drink"],
              state: "Maybe",
              address: "Waterfront street",
            },
          },
        ];
        for (const activity of activities) {
          document.places.push({
            id: activity.id,
            type: "Place",
            name: activity.properties.name,
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
          });
        }
        await route.fulfill({ json: document });
      });
      await page.goto(`${prefix}/activities`);
    });

    test("opening and dismissing search preserves card positions and aligns controls with card edges", async ({
      page,
    }, testInfo) => {
      // Exercise a persistent classic scrollbar, including platforms that normally overlay it.
      await page.addStyleTag({
        content:
          ".activity-cards::-webkit-scrollbar, .activity-cards-heading::-webkit-scrollbar { width: 16px; }",
      });
      const card = page.locator(".activity-list-item").first();
      await expect(card).toBeVisible();
      const search = page.getByRole("searchbox", {
        name: "Search activities",
        exact: true,
      });
      const heading = page.locator(".activity-cards-heading");
      const divider = page.getByRole("separator", {
        name: "Resize plan and map",
        exact: true,
      });
      let searchFontSize = 0;
      const position = () =>
        card.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return {
            top: rect.top + scrollY,
            left: rect.left,
            right: rect.right,
          };
        });
      async function checkLayout(label: string) {
        const button = page.getByRole("button", {
          name: "Search activities",
          exact: true,
        });
        await expect
          .poll(async () => {
            const bounds = (await button.boundingBox())!;
            return Math.abs(bounds.x + bounds.width - (await position()).right);
          })
          .toBeLessThanOrEqual(1);
        const before = await position();
        const height = (await heading.boundingBox())!.height;
        const buttonBounds = (await button.boundingBox())!;
        expect(buttonBounds.width).toBeGreaterThanOrEqual(44);
        expect(buttonBounds.height).toBeGreaterThanOrEqual(44);
        if (width >= 768)
          expect(buttonBounds.x + buttonBounds.width).toBeLessThanOrEqual(
            (await divider.boundingBox())!.x,
          );
        await button.click();
        await expect(search).toBeFocused();
        searchFontSize = await search.evaluate((element) =>
          parseFloat(getComputedStyle(element).fontSize),
        );
        expect(searchFontSize).toBeGreaterThanOrEqual(16);
        const after = await position();
        expect(Math.abs(after.top - before.top)).toBeLessThanOrEqual(1);
        expect(Math.abs(after.left - before.left)).toBeLessThanOrEqual(1);
        expect(Math.abs(after.right - before.right)).toBeLessThanOrEqual(1);
        expect(
          Math.abs((await heading.boundingBox())!.height - height),
        ).toBeLessThanOrEqual(1);
        const close = page.getByRole("button", {
          name: "Clear and dismiss activity search",
          exact: true,
        });
        const closeBounds = (await close.boundingBox())!;
        expect(closeBounds.width).toBeGreaterThanOrEqual(48);
        expect(closeBounds.height).toBeGreaterThanOrEqual(44);
        expect(
          Math.abs(closeBounds.x + closeBounds.width - after.right),
        ).toBeLessThanOrEqual(1);
        await page.screenshot({
          path: testInfo.outputPath(`search-layout-${label}.png`),
          fullPage: true,
        });
        await close.click();
        await expect(button).toBeFocused();
        expect(
          Math.abs((await position()).top - before.top),
        ).toBeLessThanOrEqual(1);
      }
      await checkLayout("default");
      if (width >= 768) {
        await divider.focus();
        await divider.press("Home");
        await expect
          .poll(
            async () =>
              (await page.locator(".activity-cards-section").boundingBox())!
                .width,
          )
          .toBeLessThan(261);
        await checkLayout("narrow-column");
      }
      await page
        .getByRole("button", { name: "Add activity", exact: true })
        .click();
      const drawerSearch = page
        .getByRole("dialog", { name: "Add activity", exact: true })
        .getByRole("searchbox", { name: "Find a place", exact: true });
      await expect(drawerSearch).toBeVisible();
      expect(
        await drawerSearch.evaluate((element) =>
          parseFloat(getComputedStyle(element).fontSize),
        ),
      ).toBe(searchFontSize);
    });

    test("filters and clears the list online and offline while keeping the map visible", async ({
      page,
      context,
    }, testInfo) => {
      const list = page.getByRole("list", {
        name: "Tokyo activities",
        exact: true,
      });
      await expect(
        list.getByRole("button", { name: "Museum", exact: true }),
      ).toBeVisible();
      const search = page.getByRole("searchbox", {
        name: "Search activities",
        exact: true,
      });
      const map = page.getByRole("img", { name: "Map of Tokyo", exact: true });
      await expect(
        page.getByRole("button", { name: /^(Show|Hide) map$/ }),
      ).toHaveCount(0);
      for (const offline of [false, true]) {
        if (offline) await context.setOffline(true);
        const filters = page.getByRole("group", {
          name: "Filter activities by status",
        });
        const considering = filters.getByRole("button", {
          name: "Considering activities: 1",
          exact: true,
        });
        const planned = filters.getByRole("button", {
          name: "Planned activities: 1",
          exact: true,
        });
        const rowLayout = await filters.evaluate((element) => {
          const buttons = [...element.querySelectorAll("button")];
          return {
            tops: buttons.map((button) => button.getBoundingClientRect().top),
            overflows: element.scrollWidth > element.clientWidth,
          };
        });
        expect(
          Math.max(...rowLayout.tops) - Math.min(...rowLayout.tops),
        ).toBeLessThanOrEqual(1);
        if (rowLayout.overflows) {
          await filters.hover();
          await page.mouse.wheel(600, 0);
          await expect
            .poll(() => filters.evaluate((element) => element.scrollLeft))
            .toBeGreaterThan(0);
          await page.mouse.wheel(-600, 0);
          await expect
            .poll(() => filters.evaluate((element) => element.scrollLeft))
            .toBe(0);
        }
        for (const filter of await filters.getByRole("button").all()) {
          await expect(filter).toBeEnabled();
          await expect(filter).toHaveAttribute("aria-pressed", "true");
          await expect(filter.locator("svg")).toBeVisible();
          expect((await filter.boundingBox())!.height).toBeGreaterThanOrEqual(
            44,
          );
        }
        await considering.click();
        await expect(considering).toHaveAttribute("aria-pressed", "false");
        await expect(
          list.getByRole("button", { name: "Harbour café", exact: true }),
        ).toHaveCount(0);
        await planned.focus();
        await planned.press("Space");
        await expect(
          page.getByText("No activities match your filters.", { exact: true }),
        ).toBeVisible();
        await considering.click();
        await expect(
          list.getByRole("button", { name: "Harbour café", exact: true }),
        ).toBeVisible();
        await expect(
          list.getByRole("button", { name: "Museum", exact: true }),
        ).toHaveCount(0);
        await page.screenshot({
          path: testInfo.outputPath(`activity-status-filters-${offline}.png`),
          fullPage: true,
        });
        await planned.click();
        const searchButton = page.getByRole("button", {
          name: "Search activities",
          exact: true,
        });
        await expect(searchButton).toBeVisible();
        await expect(search).toHaveCount(0);
        await searchButton.focus();
        await searchButton.press("Enter");
        await expect(search).toBeFocused();
        await expect(search).toBeEnabled();
        await expect(
          page.getByRole("heading", { name: "Activities", exact: true }),
        ).toHaveCount(0);
        await expect(
          page.getByRole("button", { name: "Add activity", exact: true }),
        ).toHaveCount(0);
        await search.fill("  MUSEUM  ");
        await expect(
          filters.getByRole("button", {
            name: "Considering activities: 0",
            exact: true,
          }),
        ).toHaveAttribute("aria-pressed", "true");
        await expect(planned).toHaveAttribute("aria-pressed", "true");
        await expect(
          list.getByRole("button", { name: "Museum", exact: true }),
        ).toBeVisible();
        await expect(
          list.getByRole("button", { name: "Harbour café", exact: true }),
        ).toHaveCount(0);
        await search.fill("waterfront");
        await expect(
          list.getByRole("button", { name: "Harbour café", exact: true }),
        ).toBeVisible();
        await expect(
          list.getByRole("button", { name: "Museum", exact: true }),
        ).toHaveCount(0);
        await expect(map).toBeVisible();
        await search.fill("not a matching activity");
        await expect(
          page.getByText("No activities match your search.", { exact: true }),
        ).toBeVisible();
        await page.getByRole("heading", { name: fixtures.trip.name }).click();
        await expect(search).toHaveValue("not a matching activity");
        await expect(
          page.getByText("No activities match your search.", { exact: true }),
        ).toBeVisible();
        await page.getByRole("tab", { name: "Plan", exact: true }).click();
        await page.getByRole("tab", { name: "Ideas", exact: true }).click();
        await expect(search).toHaveValue("not a matching activity");
        await page.screenshot({
          path: testInfo.outputPath(`activity-search-open-${offline}.png`),
          fullPage: true,
        });
        await page
          .getByRole("button", {
            name: "Clear and dismiss activity search",
            exact: true,
          })
          .click();
        await expect(search).toHaveCount(0);
        await expect(searchButton).toBeFocused();
        await expect(
          page.getByRole("heading", { name: "Activities", exact: true }),
        ).toBeVisible();
        await expect(
          list.getByRole("button", { name: "Museum", exact: true }),
        ).toBeVisible();
        await expect(
          list.getByRole("button", { name: "Harbour café", exact: true }),
        ).toBeVisible();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
      }
      await page.screenshot({
        path: testInfo.outputPath("activity-search.png"),
        fullPage: true,
      });
    });
  });
}
