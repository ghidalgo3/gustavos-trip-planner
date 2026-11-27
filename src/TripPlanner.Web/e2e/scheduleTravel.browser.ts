import { expect, test } from "@playwright/test";
import fixtures from "./fixtures.json" with { type: "json" };
import { calendarResponse } from "../src/test/activityCalendarFixture";

for (const width of [390, 1280]) {
  test.describe(`scheduled travel at ${width}px`, () => {
    test.use({ viewport: { width, height: 844 }, serviceWorkers: "block" });
    test("switches destinations on a shared day without moving the calendar controls", async ({
      page,
      request,
      context,
    }) => {
      await request.post("/__test/session", { data: { authenticated: true } });
      const prefix = `/trips/${fixtures.trip.id}`;
      const paris = {
        id: "paris-fr",
        name: "Paris",
        countryCode: "FR",
        timeZone: "Europe/Paris",
        stayId: "paris-stay",
        arrivalDate: "2027-06-10",
        departureDate: "2027-06-11",
        coordinates: [2.35, 48.86],
        order: 0,
      };
      const london = {
        id: "london-gb",
        name: "London",
        countryCode: "GB",
        timeZone: "Europe/London",
        stayId: "london-stay",
        arrivalDate: "2027-06-11",
        departureDate: "2027-06-12",
        coordinates: [-0.12, 51.5],
        order: 1,
      };
      const dates = [paris, london].map((city) => ({
        stayId: city.stayId,
        arrivalDate: city.arrivalDate,
        departureDate: city.departureDate,
      }));
      const savedDay = {
        ...calendarResponse.plan.days[0],
        stayId: london.stayId,
        date: "2027-06-13",
        name: "Museum day",
        activityIds: [],
      };
      let writes = 0;
      const loadLondon = Promise.withResolvers<void>();
      for (const city of [paris, london]) {
        const response = structuredClone(calendarResponse);
        response.plan.days = city === london ? [savedDay] : [];
        response.plan.timeZone = city.timeZone;
        response.plan.selectedActivityIds = [];
        response.assessment.days = [];
        response.context.visits = dates.filter(
          (visit) => visit.stayId === city.stayId,
        );
        await page.route(
          `**${prefix}/destinations/${city.id}/activity-plan`,
          async (route) => {
            if (route.request().method() === "PUT") writes++;
            if (city === london) await loadLondon.promise;
            return route.fulfill({ json: response, headers: { ETag: '"1"' } });
          },
        );
      }
      await page.route(`**${prefix}/document`, async (route) => {
        const result = await route.fetch();
        const document = await result.json();
        document.places = document.places.filter(
          (place: { destinationId?: string }) => !place.destinationId,
        );
        document.itinerary.items = document.itinerary.items.filter(
          (item: { kind: string }) => item.kind !== "visit",
        );
        document.preferences.destinations = [];
        for (const city of [london, paris]) {
          document.places.push({
            id: city.id,
            destinationId: city.id,
            type: "Place",
            active: true,
            name: city.name,
            countryCode: city.countryCode,
            timeZone: city.timeZone,
            location: { type: "Point", coordinates: city.coordinates },
          });
          document.itinerary.items.push({
            id: city.stayId,
            destinationId: city.id,
            placeId: city.id,
            kind: "visit",
            type: "event",
            name: city.name,
            busy: false,
            order: city.order,
            start: city.arrivalDate,
            end: city.departureDate,
          });
          document.preferences.destinations.push({
            destinationId: city.id,
            schedule: { days: city === london ? [savedDay] : [] },
          });
        }
        document.itinerary.items.push({
          id: "paris-to-london",
          kind: "flight",
          type: "event",
          busy: true,
          name: "Flight BA 307",
          originVisitId: paris.stayId,
          destinationVisitId: london.stayId,
          start: "2027-06-11T10:00:00Z",
          end: "2027-06-11T11:00:00Z",
        });
        await route.fulfill({ json: document });
      });
      await page.goto(`${prefix}/activities?destination=${paris.id}`);
      await page.getByRole("tab", { name: "Schedule", exact: true }).click();

      const day = page.getByRole("combobox", { name: "Calendar day" });
      const calendar = page.getByRole("region", { name: "Day calendar" });
      const details = page.getByRole("button", { name: "Day details" });
      const search = page.getByRole("searchbox", {
        name: "Search schedule activities",
      });
      const flight = page.getByRole("link", {
        name: "Flight BA 307",
        exact: true,
      });
      const sharedDay = "2027-06-11";
      await expect(day).toHaveValue(`${paris.stayId}:2027-06-10`);
      await expect(day.getByRole("option")).toHaveText([
        "Thursday, Jun 10",
        "Friday, Jun 11 · Paris",
        "Friday, Jun 11 · London",
        "Saturday, Jun 12",
        "Museum day · Sunday, Jun 13",
      ]);

      for (const offline of [false, true]) {
        if (offline) await context.setOffline(true);
        await day.selectOption(`${paris.stayId}:${sharedDay}`);
        await expect(flight).toContainText("12:00–13:00");
        await expect(calendar).toHaveAttribute("aria-busy", "false");
        const resize = page.getByRole("separator", {
          name: "Resize activities and calendar",
        });
        if (!offline && width >= 1100) {
          const initialWidth = await resize.getAttribute("aria-valuenow");
          await resize.press("ArrowRight");
          await expect(resize).not.toHaveAttribute(
            "aria-valuenow",
            initialWidth!,
          );
        }
        const paneWidth =
          width >= 1100 ? await resize.getAttribute("aria-valuenow") : null;
        const originalPicker = await day.elementHandle();
        const originalCalendar = await calendar.elementHandle();
        const originalSearch = await search.elementHandle();
        await day.focus();
        const pickerBounds = (await day.boundingBox())!;
        try {
          await day.selectOption(`${london.stayId}:${sharedDay}`);
          if (!offline) {
            await expect(calendar).toHaveAttribute("aria-busy", "true");
            await expect(details).toBeDisabled();
            await expect(flight).toContainText("11:00–12:00");
            await expect(day).toBeFocused();
            expect(await day.boundingBox()).toEqual(pickerBounds);
            if (paneWidth)
              await expect(resize).toHaveAttribute("aria-valuenow", paneWidth);
          }
        } finally {
          loadLondon.resolve();
        }
        await expect(calendar).toHaveAttribute("aria-busy", "false");
        await expect(details).toBeEnabled();
        await expect(flight).toContainText("11:00–12:00");
        await expect(day).toHaveValue(`${london.stayId}:${sharedDay}`);
        await expect(day).toBeFocused();
        await expect(page.getByLabel("Map of London")).toBeVisible();
        expect(
          await day.evaluate(
            (current, original) => current === original,
            originalPicker,
          ),
        ).toBe(true);
        expect(
          await calendar.evaluate(
            (current, original) => current === original,
            originalCalendar,
          ),
        ).toBe(true);
        expect(
          await search.evaluate(
            (current, original) => current === original,
            originalSearch,
          ),
        ).toBe(true);
        if (paneWidth)
          await expect(resize).toHaveAttribute("aria-valuenow", paneWidth);

        await page.getByRole("button", { name: "Next day" }).click();
        await expect(day).toHaveValue(`${london.stayId}:2027-06-12`);
        await expect(flight).toHaveCount(0);
        await page.getByRole("button", { name: "Previous day" }).click();
        await expect(flight).toContainText("11:00–12:00");
        await page.getByRole("button", { name: "Previous day" }).click();
        await expect(day).toHaveValue(`${paris.stayId}:${sharedDay}`);
        await expect(flight).toContainText("12:00–13:00");
      }
      expect(writes).toBe(0);
    });

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
      response.assessment.issues = Array.from({ length: 7 }, (_, index) => ({
        code: "travel",
        severity: "provisional",
        message: `Check travel estimate ${index + 1}`,
        date: "2026-11-23",
        activityId: null,
        duration: null,
      }));
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
          if (route.request().method() === "PUT") {
            expect(route.request().postDataJSON()).toEqual({
              plan: response.plan,
              contextVersion: response.contextVersion,
            });
            writes++;
            response.timingStale = false;
          }
          return route.fulfill({ json: response, headers: { ETag: '"1"' } });
        },
      );
      await page.goto(`${prefix}/activities?destination=london-gb`);
      await page.getByRole("tab", { name: "Schedule", exact: true }).click();
      await expect.poll(() => writes).toBe(1);
      await expect(
        page.getByRole("button", { name: "Update times" }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Review days" }),
      ).toHaveCount(0);
      const notices = page.getByRole("region", { name: "Schedule notices" });
      await expect(notices.getByRole("listitem")).toHaveCount(5);
      await notices
        .getByRole("button", { name: "View 2 more notices" })
        .click();
      const drawer = page.getByRole("dialog", {
        name: "More schedule notices",
      });
      await expect(drawer.getByRole("listitem")).toHaveText([
        "Check travel estimate 6",
        "Check travel estimate 7",
      ]);
      await drawer.getByRole("button", { name: "Close drawer" }).click();
      await expect(drawer).toBeHidden();
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
      expect(writes).toBe(1);
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
