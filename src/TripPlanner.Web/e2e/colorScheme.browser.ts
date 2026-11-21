import { test, expect, type Page } from "@playwright/test";
import fixtures from "./fixtures.json" with { type: "json" };
import { calendarActivities } from "../src/test/activityCalendarFixture";

async function expectStatusHighlightAndAlignment(page: Page, selected: string) {
  const menu = page.locator(".activity-status-menu");
  await expect(menu.locator(".fui-MenuItem__checkmark")).toHaveCount(0);
  const current = menu.getByRole("menuitemradio", {
    name: selected,
    exact: true,
  });
  await expect(current).toHaveAttribute("aria-checked", "true");
  const other = menu.getByRole("menuitemradio", {
    name: selected === "Planned" ? "Maybe" : "Planned",
    exact: true,
  });
  expect(
    await current.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    ),
  ).not.toBe(
    await other.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    ),
  );
  // Read every rectangle in one frame, allowing the popover's opening motion to finish.
  await expect
    .poll(() =>
      menu.evaluate((element) => {
        const icons = [...element.querySelectorAll(".fui-MenuItem__icon")];
        const first = icons[0].getBoundingClientRect();
        return icons.every((icon) => {
          const bounds = icon.getBoundingClientRect();
          const row = icon.parentElement!.getBoundingClientRect();
          return (
            Math.abs(bounds.x + bounds.width / 2 - first.x - first.width / 2) <=
              1 &&
            Math.abs(bounds.y + bounds.height / 2 - row.y - row.height / 2) <=
              1 &&
            row.height >= 44
          );
        });
      }),
    )
    .toBe(true);
}

for (const width of [390, 1280]) {
  for (const colorScheme of ["light", "dark"] as const) {
    test.describe(`color scheme at ${width}px in ${colorScheme}`, () => {
      test.use({
        viewport: { width, height: 844 },
        colorScheme,
        serviceWorkers: "block",
      });

      test("uses flat page colors and carries the palette into cards, menus, and drawers", async ({
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
          });
          await route.fulfill({ json: document });
        });
        await page.goto(`${prefix}/activities`);
        const main = page.locator("main");
        const shell = page.locator(".app-theme");
        const card = page.locator(".activity-list-item").first();
        await expect(card).toBeVisible();
        await expect(main).toHaveCSS("background-image", "none");
        await expect(main).toHaveCSS(
          "background-color",
          colorScheme === "dark" ? "rgb(8, 15, 27)" : "rgb(248, 250, 252)",
        );
        await expect(card).toHaveCSS(
          "background-color",
          colorScheme === "dark" ? "rgb(26, 35, 47)" : "rgb(255, 255, 255)",
        );
        const add = page.getByRole("button", {
          name: "Add activity",
          exact: true,
        });
        if (colorScheme === "dark") {
          const filter = page.getByRole("button", {
            name: "Planned activities: 1",
            exact: true,
          });
          await expect(filter).toHaveCSS("background-color", "rgb(5, 37, 5)");
          await filter.click();
          await page.mouse.move(0, 0);
          await expect(filter).toHaveCSS("background-color", "rgb(33, 45, 59)");
          await filter.hover();
          await expect(filter).toHaveCSS("background-color", "rgb(43, 59, 80)");
          await filter.click();
          await page.mouse.move(0, 0);
          await expect(add).toHaveCSS("background-color", "rgb(0, 111, 230)");
          await expect(card).toHaveCSS("color", "rgb(245, 247, 252)");
          await expect(page.getByRole("tab", { name: /^Tokyo / })).toHaveCSS(
            "border-top-color",
            "rgb(59, 185, 255)",
          );
        }
        await page
          .getByRole("button", {
            name: "Status for Museum: Planned",
            exact: true,
          })
          .click();
        const menu = page.locator(".fui-MenuPopover");
        await expect(menu).toBeVisible();
        await expect(page.getByRole("menuitemradio")).toHaveText([
          "Maybe",
          "Planned",
          "Not Interested",
        ]);
        for (const label of ["Maybe", "Planned", "Not Interested"]) {
          await expect(
            page
              .getByRole("menuitemradio", { name: label, exact: true })
              .locator("svg")
              .last(),
          ).toBeVisible();
        }
        await expect(
          page.getByRole("menuitemradio", { name: "Planned", exact: true }),
        ).toHaveAttribute("aria-checked", "true");
        await page.mouse.move(0, 0);
        await expectStatusHighlightAndAlignment(page, "Planned");
        expect(
          await menu.evaluate(
            (element) => getComputedStyle(element).backgroundColor,
          ),
        ).toBe(
          await card.evaluate(
            (element) => getComputedStyle(element).backgroundColor,
          ),
        );
        if (colorScheme === "dark")
          await expect(
            page.getByRole("menuitem", {
              name: "Remove activity",
              exact: true,
            }),
          ).toHaveCSS("color", "rgb(255, 107, 107)");
        await page.screenshot({
          path: testInfo.outputPath("activity-palette.png"),
          fullPage: true,
          animations: "disabled",
        });
        await page.keyboard.press("Escape");
        await add.click();
        const drawer = page.getByRole("dialog", {
          name: "Add activity",
          exact: true,
        });
        await expect(drawer).toBeVisible();
        await drawer
          .getByRole("button", { name: "Status Maybe", exact: true })
          .click();
        await page.mouse.move(0, 0);
        await expectStatusHighlightAndAlignment(page, "Maybe");
        await page.screenshot({
          path: testInfo.outputPath("drawer-status-menu.png"),
          fullPage: true,
          animations: "disabled",
        });
        await page.keyboard.press("Escape");
        expect(
          await drawer.evaluate(
            (element) => getComputedStyle(element).backgroundColor,
          ),
        ).toBe(
          await card.evaluate(
            (element) => getComputedStyle(element).backgroundColor,
          ),
        );
        await drawer.screenshot({
          path: testInfo.outputPath("drawer-palette.png"),
          animations: "disabled",
        });
        await page
          .getByRole("button", { name: "Close activity drawer", exact: true })
          .click();
        const nextScheme = colorScheme === "dark" ? "light" : "dark";
        await page.emulateMedia({ colorScheme: nextScheme });
        await expect(shell).toHaveAttribute("data-color-scheme", nextScheme);
        await expect(main).toHaveCSS("background-image", "none");
        await expect(main).toHaveCSS(
          "background-color",
          nextScheme === "dark" ? "rgb(8, 15, 27)" : "rgb(248, 250, 252)",
        );
      });
    });
  }
}
