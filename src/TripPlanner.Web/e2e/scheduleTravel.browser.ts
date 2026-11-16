import { expect, test } from "@playwright/test";
import fixtures from "./fixtures.json" with { type: "json" };
import { calendarResponse } from "../src/test/activityCalendarFixture";

for (const width of [390, 1280]) {
  test.describe(`scheduled travel at ${width}px`, () => {
    test.use({ viewport: { width, height: 844 }, serviceWorkers: "block" });
    test("London flights appear after visit dates change beyond the saved activity plan", async ({
      page,
      request,
      context,
    }, testInfo) => {
      await request.post("/__test/session", { data: { authenticated: true } });
      const prefix = `/trips/${fixtures.trip.id}`;
      const stayId = "3adef19e-cab2-45e3-b9b9-fa744174bd32";
      const response = structuredClone(calendarResponse);
      response.plan.timeZone = "Europe/London";
      response.plan.days = [12, 13, 14, 15].map((date) => ({
        ...response.plan.days[0],
        stayId,
        date: `2026-11-${date}`,
        activityIds: [],
      }));
      response.context.visits = [
        { stayId, arrivalDate: "2026-11-23", departureDate: "2026-11-28" },
      ];
      response.context.destinationName = "London";
      response.timingStale = true;
      response.assessment.days = [];
      let writes = 0;
      await page.route(`**${prefix}/document`, async (route) => {
        const result = await route.fetch();
        const document = await result.json();
        const place = document.places.find(
          (place: { destinationId?: string }) =>
            place.destinationId === fixtures.destination.id,
        );
        Object.assign(place, {
          destinationId: "london-gb",
          name: "London",
          timeZone: "Europe/London",
          countryCode: "GB",
        });
        const visit = document.itinerary.items.find(
          (item: { kind: string }) => item.kind === "visit",
        );
        Object.assign(visit, {
          id: stayId,
          destinationId: "london-gb",
          name: "London",
          start: "2026-11-23",
          end: "2026-11-28",
        });
        document.preferences.destinations[0].destinationId = "london-gb";
        document.itinerary.items.push(
          {
            id: "jetblue-to-london",
            kind: "flight",
            name: "Flight B6 1107",
            type: "event",
            busy: true,
            destinationVisitId: stayId,
            start: "2026-11-23T14:26:00Z",
            end: "2026-11-23T21:40:00Z",
          },
          {
            id: "klm-from-london",
            kind: "flight",
            name: "Flight KL 1000",
            type: "event",
            busy: true,
            originVisitId: stayId,
            start: "2026-11-28T06:30:00Z",
            end: "2026-11-28T08:00:00Z",
          },
        );
        await route.fulfill({ json: document });
      });
      await page.route(
        `**${prefix}/destinations/london-gb/activity-plan`,
        (route) => {
          if (route.request().method() === "PUT") writes++;
          return route.fulfill({ json: response, headers: { ETag: '"1"' } });
        },
      );
      await page.goto(`${prefix}/activities?destination=london-gb`);
      await page.getByRole("tab", { name: "Schedule", exact: true }).click();
      for (const offline of [false, true]) {
        if (offline) await context.setOffline(true);
        const day = page.getByRole("combobox", { name: "Calendar day" });
        await expect(day).toHaveValue(`${stayId}:2026-11-23`);
        await expect(day.getByRole("option")).toHaveCount(10);
        const inbound = page.getByRole("link", {
          name: "Flight B6 1107",
          exact: true,
        });
        await expect(inbound).toContainText("14:26–21:40");
        await expect(inbound).toHaveAttribute("href", `${prefix}/flights`);
        await inbound.focus();
        await page.screenshot({
          path: testInfo.outputPath(`london-arrival-${offline}.png`),
          fullPage: true,
        });
        await day.selectOption(`${stayId}:2026-11-28`);
        await expect(
          page.getByRole("link", { name: "Flight KL 1000", exact: true }),
        ).toContainText("06:30–08:00");
        await expect(inbound).toHaveCount(0);
        await day.selectOption(`${stayId}:2026-11-12`);
        await expect(
          page.getByText("No events scheduled", { exact: true }),
        ).toBeVisible();
        await day.selectOption(`${stayId}:2026-11-23`);
      }
      expect(writes).toBe(0);
    });
    test("opens flight links and transportation details on their days, including offline", async ({
      page,
      request,
      context,
    }, testInfo) => {
      await request.post("/__test/session", { data: { authenticated: true } });
      const prefix = `/trips/${fixtures.trip.id}`;
      const response = structuredClone(calendarResponse);
      response.plan.days.forEach((day) => {
        day.activityIds = [];
      });
      response.plan.selectedActivityIds = [];
      response.assessment.days.forEach((day) => {
        day.entries = [];
        day.travel = [];
        day.breaks = [];
      });
      const transportation = {
        type: "FeatureCollection",
        id: "airport-express",
        name: "Airport express",
        notes: "Take the train from platform 2.",
        mode: "train",
        departureDate: "2027-06-10",
        departureTime: "11:00:00",
        timeZone: "Europe/Paris",
        duration: "PT45M",
        features: [
          {
            type: "Feature",
            id: "from",
            geometry: null,
            properties: { name: "Airport station" },
          },
          {
            type: "Feature",
            id: "to",
            geometry: null,
            properties: { name: "City station" },
          },
        ],
        etag: "train-1",
        version: 1,
        routeStale: false,
      };
      await page.route(`**${prefix}/document`, async (route) => {
        const result = await route.fetch();
        const document = await result.json();
        document.itinerary.items.push(
          {
            id: "flight-arrival",
            kind: "flight",
            name: "Flight AF 123",
            type: "event",
            busy: true,
            destinationVisitId: response.plan.days[0].stayId,
            start: "2027-06-10T07:00:00Z",
            end: "2027-06-10T08:00:00Z",
          },
          {
            id: transportation.id,
            kind: "transportation",
            name: transportation.name,
            type: "event",
            busy: true,
            start: "2027-06-10T09:00:00Z",
            duration: transportation.duration,
            transportation,
          },
        );
        await route.fulfill({ json: document });
      });
      await page.route(
        `**${prefix}/destinations/${fixtures.destination.id}/activity-plan`,
        (route) => route.fulfill({ json: response, headers: { ETag: '"1"' } }),
      );
      await page.goto(`${prefix}/activities`);
      await page.getByRole("tab", { name: "Schedule", exact: true }).click();
      for (const offline of [false, true]) {
        if (offline) await context.setOffline(true);
        const flight = page.getByRole("link", {
          name: "Flight AF 123",
          exact: true,
        });
        await expect(flight).toHaveAttribute("href", `${prefix}/flights`);
        await expect(flight).toContainText("09:00–10:00");
        const train = page.getByRole("button", {
          name: "Airport express",
          exact: true,
        });
        await expect(train).toContainText("11:00–11:45");
        await expect(
          page.getByText("No events scheduled", { exact: true }),
        ).toHaveCount(0);
        await train.click();
        const drawer = page.getByRole("dialog", {
          name: "Airport express",
          exact: true,
        });
        await expect(
          drawer.getByText(transportation.notes, { exact: true }),
        ).toBeVisible();
        await expect(
          drawer.getByText("Airport station", { exact: true }),
        ).toBeVisible();
        await expect(
          drawer.getByText("City station", { exact: true }),
        ).toBeVisible();
        await drawer
          .getByRole("button", { name: "Close event", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Next day", exact: true })
          .click();
        await expect(flight).toHaveCount(0);
        await expect(train).toHaveCount(0);
        await page
          .getByRole("button", { name: "Previous day", exact: true })
          .click();
        await page.screenshot({
          path: testInfo.outputPath(`scheduled-travel-${offline}.png`),
          fullPage: true,
        });
        await flight.click();
        await expect(page).toHaveURL(`${prefix}/flights`);
        await page.goBack();
        await page.getByRole("tab", { name: "Schedule", exact: true }).click();
      }
    });
  });
}
