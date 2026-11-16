import { test, expect } from "@playwright/test";
import fixtures from "./fixtures.json" with { type: "json" };
import type {
  ActivityPlan,
  PlanResponse,
} from "../src/features/activities/activityPlanApi";

for (const width of [390, 1280]) {
  test.describe(`day names at ${width}px`, () => {
    test.use({ viewport: { width, height: 844 }, serviceWorkers: "block" });

    test("wraps names, saves on blur, and keeps the calendar available offline", async ({
      page,
      request,
    }, testInfo) => {
      await request.post("/__test/session", { data: { authenticated: true } });
      const { trip, destination } = fixtures;
      const date = destination.properties.stays[0].arrivalDate!;
      const initialName =
        "A full day exploring EPCOT, the World Showcase, and the evening fireworks together";
      let version = 1;
      let plan: ActivityPlan = {
        selectedActivityIds: [],
        excludedActivityIds: [],
        rules: [],
        transportOverrides: [],
        timeZone: destination.properties.timeZone,
        settings: {
          sleepStart: "23:00:00",
          sleepEnd: "07:00:00",
          breakfastDuration: "PT30M",
          lunchDuration: "PT45M",
          dinnerDuration: "PT45M",
          slackDuration: "PT60M",
          transportMode: "fastest",
          airportArrivalBufferDuration: "PT60M",
          airportDepartureBufferDuration: "PT120M",
          airportTransferDuration: "PT60M",
        },
        days: [
          {
            stayId: destination.properties.stays[0].id,
            date,
            name: initialName,
            activityIds: [],
            settings: null,
            availableFrom: null,
            availableUntil: null,
            availabilityConfirmed: false,
          },
        ],
      };
      const assessment: PlanResponse["assessment"] = {
        status: "fits",
        issues: [],
        days: [],
        travellerFit: [],
        groupUtility: 0,
        evaluatedAt: "2026-11-08T12:00:00Z",
        conflictCount: 0,
        travelDuration: "PT0M",
        overrunDuration: "PT0M",
        evidence: [],
      };
      const writes: ActivityPlan[] = [];
      await page.route(`**/trips/${trip.id}/document`, async (route) => {
        const result = await route.fetch();
        const document = await result.json();
        document.revision = `day-name-${version}`;
        document.preferences.destinations[0].schedule = {
          ...plan,
          etag: String(version),
          version,
          contextVersion: "1",
        };
        await route.fulfill({ json: document });
      });
      await page.route(
        `**/trips/${trip.id}/destinations/${destination.id}/activity-plan`,
        async (route) => {
          if (route.request().method() === "PUT") {
            expect(route.request().headers()["if-match"]).toBe(`"${version}"`);
            plan = route.request().postDataJSON().plan;
            writes.push(plan);
            version++;
          }
          await route.fulfill({
            headers: { ETag: `"${version}"`, "Planning-Context": "1" },
            json: {
              plan,
              version,
              contextVersion: "1",
              assessment,
              savedAssessment: assessment,
              timingStale: false,
              context: {
                destinationName: destination.properties.name,
                tripInstructions: "",
                destinationInstructions: "",
                suggestedAvailability: [],
              },
            } satisfies PlanResponse,
          });
        },
      );
      await page.goto(`/trips/${trip.id}/activities`);
      await page.getByRole("tab", { name: "Schedule", exact: true }).click();
      await page
        .getByRole("button", { name: "Day details", exact: true })
        .click();
      const editor = page.getByRole("textbox", { name: "Day name (optional)" });
      await expect(editor).toHaveValue(initialName);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await page
        .getByRole("dialog")
        .screenshot({ path: testInfo.outputPath("day-name.png") });
      await editor.fill("EPCOT Visit");
      expect(writes).toHaveLength(0);
      await editor.blur();
      await expect(
        page.locator('select[aria-label="Calendar day"] option:checked'),
      ).toHaveText(/^EPCOT Visit ·/);
      await expect(editor).toBeEnabled();
      expect(writes).toHaveLength(1);
      expect(writes[0].days[0].name).toBe("EPCOT Visit");
      await page.context().setOffline(true);
      await expect(
        page.getByText("Offline · View only", { exact: true }),
      ).toBeVisible();
      await expect(editor).toHaveValue("EPCOT Visit");
      await expect(editor).toBeDisabled();
      await page.getByRole("button", { name: "Close", exact: true }).click();
      await page
        .getByRole("button", { name: "Day details", exact: true })
        .click();
      await expect(editor).toBeVisible();
      await page.getByRole("button", { name: "Close", exact: true }).click();
      await page.getByRole("tab", { name: "Ideas", exact: true }).click();
      await page.getByRole("tab", { name: "Schedule", exact: true }).click();
      await expect(
        page.locator('select[aria-label="Calendar day"] option:checked'),
      ).toHaveText(/^EPCOT Visit ·/);
    });
  });
}
