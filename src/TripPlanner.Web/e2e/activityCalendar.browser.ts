import { test, expect } from "@playwright/test";
import fixtures from "./fixtures.json" with { type: "json" };
import {
  calendarActivities,
  calendarResponse,
} from "../src/test/activityCalendarFixture";
const clockMinutes = (clock: string) =>
  Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));
const calendarClock = (minutes: number) =>
  `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
import { durationMinutes } from "../src/shared/time/durations";
import type { ActivityPlan } from "../src/features/activities/activityPlanApi";

for (const width of [390, 1280]) {
  test.describe(`activity calendar at ${width}px`, () => {
    test.use({ viewport: { width, height: 844 }, serviceWorkers: "block" });
    test("edits event times and transportation on the calendar, preserving it offline", async ({
      page,
      request,
    }, testInfo) => {
      await request.post("/__test/session", { data: { authenticated: true } });
      const response = structuredClone(calendarResponse);
      const writes: ActivityPlan[] = [];
      const path = `/trips/${fixtures.trip.id}/destinations/${fixtures.destination.id}/activity-plan`;
      await page.route(
        `**/trips/${fixtures.trip.id}/document`,
        async (route) => {
          const result = await route.fetch();
          const document = await result.json();
          document.revision = `calendar-${response.version}`;
          document.preferences.destinations[0].schedule = {
            ...response.plan,
            etag: String(response.version),
            version: response.version,
            contextVersion: response.contextVersion,
          };
          for (const activity of calendarActivities) {
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
          }
          await route.fulfill({ json: document });
        },
      );
      await page.route(`**${path}`, async (route) => {
        if (route.request().method() === "PUT") {
          expect(route.request().headers()["if-match"]).toBe(
            `"${response.version}"`,
          );
          response.plan = route.request().postDataJSON().plan;
          writes.push(structuredClone(response.plan));
          response.version++;
          for (const entry of response.assessment.days[0].entries) {
            const rule = response.plan.rules.find(
              (item) => item.activityId === entry.activityId,
            );
            if (!rule?.fixedStart) continue;
            entry.start = `2027-06-10T${rule.fixedStart}+02:00`;
            entry.end = `2027-06-10T${calendarClock(clockMinutes(rule.fixedStart) + (durationMinutes(rule.duration) ?? 60))}:00+02:00`;
          }
          const override = response.plan.transportOverrides[0];
          if (override) {
            response.assessment.days[0].travel[0].mode = override.mode;
            response.assessment.days[0].travel[0].duration = override.duration!;
          }
        }
        await route.fulfill({
          headers: {
            ETag: `"${response.version}"`,
            "Planning-Context": response.contextVersion,
          },
          json: response,
        });
      });
      await page.route(`**${path}/previews`, (route) =>
        route.fulfill({ json: response.assessment }),
      );
      await page.route("**/mapToken", (route) =>
        route.fulfill({
          json: {
            token: "test-sas",
            endpoint: "https://atlas.example.test",
            expiresAt: "2099-01-01T00:00:00Z",
          },
        }),
      );
      await page.route("https://atlas.example.test/**", (route) =>
        route.fulfill({
          json: {
            properties: {
              matrix: [
                {
                  statusCode: 200,
                  durationInSeconds:
                    route.request().postDataJSON().travelMode === "driving"
                      ? 601
                      : 1801,
                },
              ],
            },
          },
        }),
      );
      await page.goto(`/trips/${fixtures.trip.id}/activities`);
      await expect(
        page.getByRole("tab", { name: "Plan", exact: true }),
      ).toBeVisible({ timeout: 10_000 });
      await page.getByRole("tab", { name: "Plan", exact: true }).click();
      const calendar = page.getByRole("region", {
        name: "Day calendar",
        exact: true,
      });
      await expect(calendar).toBeVisible();
      await expect(
        page.getByRole("button", { name: /^(Show|Hide) map$/ }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("img", { name: "Map of Tokyo" }),
      ).toBeVisible();
      await calendar.screenshot({ path: testInfo.outputPath("calendar.png") });
      await page.screenshot({
        path: testInfo.outputPath("calendar-page.png"),
        fullPage: true,
      });
      await page.getByRole("button", { name: "Museum", exact: true }).click();
      await page.getByLabel("Event start", { exact: true }).fill("08:30");
      await page.getByLabel("Event end", { exact: true }).fill("10:00");
      expect(writes).toHaveLength(0);
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      expect(writes[0].rules[0]).toMatchObject({
        fixedStart: "08:30:00",
        duration: "PT90M",
      });
      await expect(
        calendar.getByText("08:30–10:00", { exact: true }),
      ).toBeVisible();
      await page
        .getByRole("button", {
          name: "Walking from Museum to Garden",
          exact: true,
        })
        .click();
      await page
        .getByLabel("Transportation mode", { exact: true })
        .selectOption("driving");
      await page
        .getByRole("button", { name: "Calculate travel time", exact: true })
        .click();
      await expect(
        page.getByLabel("Travel time (minutes)", { exact: true }),
      ).toHaveValue("11");
      await expect(
        page.getByRole("button", {
          name: "Calculate travel time",
          exact: true,
        }),
      ).toBeEnabled();
      await page.getByRole("dialog").screenshot({
        path: testInfo.outputPath("transportation.png"),
        animations: "disabled",
      });
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      expect(writes[1].transportOverrides[0]).toMatchObject({
        mode: "driving",
        duration: "PT11M",
      });
      await expect(
        page.getByRole("button", {
          name: "Driving from Museum to Garden",
          exact: true,
        }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.context().setOffline(true);
      await page.getByRole("button", { name: "Museum", exact: true }).click();
      await expect(page.getByLabel("Event start", { exact: true })).toHaveValue(
        "08:30",
      );
      await expect(
        page.getByLabel("Event start", { exact: true }),
      ).toBeDisabled();
      await expect(
        page.getByRole("button", { name: "Save", exact: true }),
      ).toHaveCount(0);
      await page.getByRole("button", { name: "Close", exact: true }).click();
      await page.getByRole("button", { name: "Next day", exact: true }).click();
      await expect(
        page.getByText("No events scheduled", { exact: true }),
      ).toBeVisible();
    });
  });
}
