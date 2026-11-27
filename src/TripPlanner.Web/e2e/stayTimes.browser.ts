import { expect, test } from "@playwright/test";
import fixtures from "./fixtures.json" with { type: "json" };
import { calendarResponse } from "../src/test/activityCalendarFixture";

for (const width of [320, 390, 1280]) {
  for (const colorScheme of ["light", "dark"] as const) {
    test.describe(`stay times at ${width}px in ${colorScheme}`, () => {
      test.use({
        viewport: { width, height: 844 },
        colorScheme,
        serviceWorkers: "block",
      });
      test("saves stay Details and shows check-in/out calendar events after reload and offline", async ({
        page,
        request,
        context,
      }, testInfo) => {
        await request.post("/__test/session", {
          data: { authenticated: true },
        });
        const prefix = `/trips/${fixtures.trip.id}`;
        const visit = fixtures.destination.properties.stays[0];
        const hotelId = "11111111-1111-4111-8111-111111111111";
        let clocks = { checkInTime: "16:00:00", checkOutTime: "11:00:00" };
        let version = 1;
        const saved: Record<string, unknown>[] = [];
        let completeSave: () => void = () => {};
        await page.route(`**${prefix}/document`, async (route) => {
          const response = await route.fetch();
          const document = await response.json();
          document.revision = `stay-${version}`;
          document.places.push({
            id: "hotel",
            hotelId,
            name: "Tokyo Hotel",
            type: "Place",
            address: "Hotel street",
            location: fixtures.destination.geometry,
            version: 1,
            etag: "hotel-1",
          });
          document.itinerary.items.push({
            id: "lodging",
            kind: "lodging",
            type: "event",
            busy: false,
            name: "Tokyo Hotel",
            placeId: "hotel",
            visitId: visit.id,
            start: visit.arrivalDate,
            end: visit.departureDate,
            etag: `stay-${version}`,
            ...clocks,
          });
          await route.fulfill({ json: document });
        });
        await page.route(
          `**${prefix}/destinations/${fixtures.destination.id}/stays/${visit.id}/location`,
          async (route) => {
            const feature = route.request().postDataJSON();
            saved.push(feature);
            await new Promise<void>((resolve) => {
              completeSave = resolve;
            });
            clocks = {
              checkInTime: feature.properties.checkInTime,
              checkOutTime: feature.properties.checkOutTime,
            };
            version++;
            await route.fulfill({ json: feature });
          },
        );
        const response = structuredClone(calendarResponse);
        response.plan.timeZone = "Asia/Tokyo";
        response.plan.selectedActivityIds = [];
        response.plan.rules = [];
        response.plan.days = [visit.arrivalDate, visit.departureDate].map(
          (date) => ({
            ...response.plan.days[0],
            stayId: visit.id,
            date,
            activityIds: [],
          }),
        );
        response.context.visits = [
          {
            stayId: visit.id,
            arrivalDate: visit.arrivalDate,
            departureDate: visit.departureDate,
          },
        ];
        response.assessment.days = [];
        await page.route(
          `**${prefix}/destinations/${fixtures.destination.id}/activity-plan`,
          (route) =>
            route.fulfill({ json: response, headers: { ETag: '"1"' } }),
        );
        await page.goto(prefix);
        await page
          .getByRole("button", { name: "Tokyo Hotel in Tokyo", exact: true })
          .click();
        const drawer = page.getByRole("dialog", {
          name: "Stay in Tokyo",
          exact: true,
        });
        await drawer.locator("summary").filter({ hasText: "Details" }).click();
        const checkIn = drawer.getByLabel("Check-in", { exact: true });
        const checkOut = drawer.getByLabel("Check-out", { exact: true });
        await expect(checkIn).toHaveValue("16:00");
        await expect(checkOut).toHaveValue("11:00");
        for (const input of [checkIn, checkOut]) {
          expect(
            await input.evaluate((element) =>
              parseFloat(getComputedStyle(element).fontSize),
            ),
          ).toBeGreaterThanOrEqual(16);
        }
        await checkIn.fill("18:30");
        await checkOut.fill("10:15");
        expect(saved).toHaveLength(0);
        const save = drawer.getByRole("button", {
          name: "Save times",
          exact: true,
        });
        const box = (await save.boundingBox())!;
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.width).toBeGreaterThanOrEqual(box.height);
        await save.click();
        await expect.poll(() => saved.length).toBe(1);
        await expect(checkIn).toBeDisabled();
        await expect(checkOut).toBeDisabled();
        await expect(checkIn).toHaveValue("18:30");
        completeSave();
        await expect(checkIn).toBeEnabled();
        await expect(save).toBeDisabled();
        expect(saved[0]).toMatchObject({
          properties: {
            hotelId,
            name: "Tokyo Hotel",
            address: "Hotel street",
            checkInTime: "18:30:00",
            checkOutTime: "10:15:00",
          },
        });
        await drawer.screenshot({
          path: testInfo.outputPath("stay-details.png"),
        });
        await drawer.getByRole("button", { name: "Done", exact: true }).click();
        await page.reload();
        await page
          .getByRole("button", { name: "Tokyo Hotel in Tokyo", exact: true })
          .click();
        await drawer.locator("summary").filter({ hasText: "Details" }).click();
        await expect(checkIn).toHaveValue("18:30");
        await expect(checkOut).toHaveValue("10:15");
        await drawer.getByRole("button", { name: "Done", exact: true }).click();
        await page.locator(".overview-destination-link").first().press("Enter");
        await page.getByRole("tab", { name: "Schedule", exact: true }).click();
        for (const offline of [false, true]) {
          if (offline) await context.setOffline(true);
          const day = page.getByRole("combobox", { name: "Calendar day" });
          await day.selectOption(`${visit.id}:${visit.arrivalDate}`);
          const arrival = page.getByRole("button", {
            name: "Check-in · Tokyo Hotel",
            exact: true,
          });
          await expect(arrival).toContainText("18:30");
          await expect(arrival).toBeEnabled();
          await expect(
            page.getByRole("button", {
              name: "Check-out · Tokyo Hotel",
              exact: true,
            }),
          ).toHaveCount(0);
          await arrival.click();
          await expect(
            page
              .getByRole("dialog", {
                name: "Check-in · Tokyo Hotel",
                exact: true,
              })
              .getByText("18:30", { exact: true }),
          ).toBeVisible();
          await page
            .getByRole("button", { name: "Close event", exact: true })
            .click();
          await day.selectOption(`${visit.id}:${visit.departureDate}`);
          const departure = page.getByRole("button", {
            name: "Check-out · Tokyo Hotel",
            exact: true,
          });
          await expect(departure).toContainText("10:15");
          await expect(departure).toBeEnabled();
          await expect(arrival).toHaveCount(0);
          await departure.focus();
          await page.screenshot({
            path: testInfo.outputPath(`stay-calendar-${offline}.png`),
            fullPage: true,
          });
        }
        expect(saved).toHaveLength(1);
      });
    });
  }
}
