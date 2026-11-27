import { test, expect, type Locator } from "@playwright/test";
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

for (const width of [390, 820, 1100, 1280]) {
  test.describe(`activity calendar at ${width}px`, () => {
    test.use({ viewport: { width, height: 844 }, serviceWorkers: "block" });
    test("edits event times and transportation on the calendar, preserving it offline", async ({
      page,
      request,
    }, testInfo) => {
      await request.post("/__test/session", { data: { authenticated: true } });
      const response = structuredClone(calendarResponse);
      const writes: ActivityPlan[] = [];
      let failNextSave = false;
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
          if (failNextSave) {
            failNextSave = false;
            await route.fulfill({
              status: 503,
              json: { title: "Schedule unavailable. Try again." },
            });
            return;
          }
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
        page.getByRole("tab", { name: "Schedule", exact: true }),
      ).toBeVisible({ timeout: 10_000 });
      const mapPanel = page.locator(".activity-map-panel");
      const activityViews = page.getByRole("tablist", {
        name: "Activity views",
      });
      const activitiesPane = page.getByRole("region", {
        name: "Destination activities",
      });
      const originalMap = width < 768 ? await mapPanel.elementHandle() : null;
      const measureMap = async () => {
        const mapBounds = (await mapPanel.boundingBox())!;
        const tabBounds = (await activityViews.boundingBox())!;
        const contentBounds = (await activitiesPane.boundingBox())!;
        expect(mapBounds.y + mapBounds.height).toBeLessThanOrEqual(
          contentBounds.y,
        );
        return mapBounds.y - tabBounds.y;
      };
      const ideasMapPosition = originalMap ? await measureMap() : null;
      await page.getByRole("tab", { name: "Schedule", exact: true }).click();
      const calendar = page.getByRole("region", {
        name: "Day calendar",
        exact: true,
      });
      await expect(calendar).toBeVisible();
      if (width === 1100) {
        const rowPosition = async (
          name: string,
          role: "button" | "combobox" = "button",
        ) => {
          const bounds = (await page
            .getByRole(role, { name, exact: true })
            .boundingBox())!;
          return bounds.y + bounds.height / 2;
        };
        const dayPicker = page.getByRole("combobox", { name: "Calendar day" });
        expect((await dayPicker.boundingBox())!.width).toBeGreaterThanOrEqual(
          160,
        );
        const firstRow = await rowPosition("Calendar day", "combobox");
        expect(await rowPosition("Previous day")).toBe(firstRow);
        expect(await rowPosition("Next day")).toBe(firstRow);
        const secondRow = await rowPosition("Day details");
        expect(secondRow).toBeGreaterThan(firstRow);
        expect(await rowPosition("Add event")).toBe(secondRow);
      }
      if (originalMap) {
        expect(
          await mapPanel.evaluate(
            (panel, original) => panel === original,
            originalMap,
          ),
        ).toBe(true);
        expect(await measureMap()).toBe(ideasMapPosition);
        await page.getByRole("tab", { name: "Ideas", exact: true }).click();
        expect(await measureMap()).toBe(ideasMapPosition);
        await page.getByRole("tab", { name: "Schedule", exact: true }).click();
        await expect(calendar).toBeVisible();
      }
      if (width < 1100) {
        const schedule = page.getByRole("region", {
          name: "Activity calendar",
        });
        await expect(calendar).toHaveClass("calendar-agenda");
        const nestedScrollRegions = await schedule.evaluate(
          (root) =>
            [...root.querySelectorAll("*")].filter(
              (element) =>
                element.clientHeight > 0 &&
                element.scrollHeight > element.clientHeight + 1 &&
                /auto|scroll/.test(getComputedStyle(element).overflowY),
            ).length,
        );
        expect(nestedScrollRegions).toBe(0);
        const museum = await calendar
          .getByRole("button", { name: "Museum", exact: true })
          .boundingBox();
        const garden = await calendar
          .getByRole("button", { name: "Garden", exact: true })
          .boundingBox();
        expect(museum!.y + museum!.height).toBeLessThan(garden!.y);
      }
      await expect(
        page.getByRole("button", { name: /^(Show|Hide) map$/ }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("img", { name: "Map of Tokyo" }),
      ).toBeVisible();
      const search = page.getByRole("searchbox", {
        name: "Search schedule activities",
      });
      expect(
        await search.evaluate((input) =>
          parseFloat(getComputedStyle(input).fontSize),
        ),
      ).toBeGreaterThanOrEqual(16);
      await search.fill("cafe");
      await expect(
        page.getByRole("button", { name: "Schedule Museum", exact: true }),
      ).toHaveCount(0);
      const clearSearch = page.getByRole("button", {
        name: "Clear schedule activity search",
      });
      expect((await clearSearch.boundingBox())!.width).toBeGreaterThanOrEqual(
        48,
      );
      await clearSearch.click();
      if (width >= 1100) {
        const list = page.getByRole("complementary", {
          name: "Schedule activities",
        });
        const listBox = (await list.boundingBox())!;
        const calendarBox = (await calendar.boundingBox())!;
        const mapBox = (await page
          .locator(".activity-map-panel")
          .boundingBox())!;
        expect(listBox.x + listBox.width).toBeLessThan(calendarBox.x);
        expect(calendarBox.x + calendarBox.width).toBeLessThan(mapBox.x);
        const divider = page.getByRole("separator", {
          name: "Resize activities and calendar",
        });
        await divider.focus();
        await page.keyboard.press("ArrowRight");
        expect((await list.boundingBox())!.width).toBeGreaterThan(
          listBox.width,
        );
        await page.keyboard.press("ArrowLeft");
        const mapDivider = page.getByRole("separator", {
          name: "Resize plan and map",
        });
        const dividerBox = (await mapDivider.boundingBox())!;
        await page.mouse.move(
          dividerBox.x + dividerBox.width / 2,
          dividerBox.y + dividerBox.height / 2,
        );
        await page.mouse.down();
        await page.mouse.move(
          dividerBox.x - 30,
          dividerBox.y + dividerBox.height / 2,
          { steps: 5 },
        );
        await page.mouse.up();
        expect(
          (await page.locator(".activity-map-panel").boundingBox())!.width,
        ).toBeGreaterThan(mapBox.width);
      }
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
      if (width >= 1100) {
        const dragBy = async (source: Locator, pixels: number) => {
          const box = (await source.boundingBox())!;
          const x = box.x + Math.min(80, box.width / 2);
          const y = box.y + Math.min(20, box.height / 2);
          await page.mouse.move(x, y);
          await page.mouse.down();
          await page.mouse.move(x, y + pixels, { steps: 8 });
          await page.mouse.up();
        };
        await calendar.evaluate((element) => {
          element.scrollTop = 7 * 90;
        });
        await dragBy(
          calendar.getByRole("button", { name: "Museum", exact: true }),
          45,
        );
        await expect.poll(() => writes.length).toBe(3);
        expect(
          writes[2].rules.find((rule) => rule.activityId === "activity-0"),
        ).toMatchObject({ fixedStart: "09:00:00", duration: "PT90M" });
        await expect(
          calendar.getByRole("button", {
            name: "Resize Museum end",
            exact: true,
          }),
        ).toBeEnabled();
        await calendar.evaluate((element) => {
          element.scrollTop = 8 * 90;
        });
        await dragBy(
          calendar.getByRole("button", {
            name: "Resize Museum end",
            exact: true,
          }),
          45,
        );
        await expect.poll(() => writes.length).toBe(4);
        expect(
          writes[3].rules.find((rule) => rule.activityId === "activity-0"),
        ).toMatchObject({ fixedStart: "09:00:00", duration: "PT120M" });
        await expect(
          calendar.getByRole("button", { name: "Museum", exact: true }),
        ).toBeEnabled();
        await dragBy(
          calendar.getByRole("button", {
            name: "Resize Museum start",
            exact: true,
          }),
          -22.5,
        );
        await expect.poll(() => writes.length).toBe(5);
        expect(
          writes[4].rules.find((rule) => rule.activityId === "activity-0"),
        ).toMatchObject({ fixedStart: "08:45:00", duration: "PT135M" });

        await calendar.evaluate((element) => {
          element.scrollTop = 10 * 90;
        });
        const cafe = (await page
          .getByRole("button", { name: "Schedule Cafe", exact: true })
          .boundingBox())!;
        const grid = (await page.locator(".calendar-events").boundingBox())!;
        await page.mouse.move(
          cafe.x + cafe.width / 2,
          cafe.y + cafe.height / 2,
        );
        await page.mouse.down();
        await page.mouse.move(grid.x + grid.width / 2, grid.y + 12 * 90, {
          steps: 10,
        });
        await expect(page.locator(".calendar-drag-preview")).toHaveText(
          /Cafe12:00–13:00/,
        );
        expect(writes).toHaveLength(5);
        await page.mouse.up();
        await expect.poll(() => writes.length).toBe(6);
        expect(
          writes[5].rules.find((rule) => rule.activityId === "activity-2"),
        ).toMatchObject({
          fixedDate: "2027-06-10",
          fixedStart: "12:00:00",
          duration: "PT60M",
        });
        expect(writes[5].transportOverrides).toEqual(
          writes[4].transportOverrides,
        );
        await expect(
          calendar.getByRole("button", { name: "Cafe", exact: true }),
        ).toBeEnabled();

        // Failed gestures keep the last confirmed event and can retry the same change.
        failNextSave = true;
        await dragBy(
          calendar.getByRole("button", { name: "Cafe", exact: true }),
          22.5,
        );
        await expect(
          page
            .getByRole("region", { name: "Activity calendar", exact: true })
            .getByRole("alert"),
        ).toContainText("Schedule unavailable.");
        await expect(
          calendar.getByText("12:00–13:00", { exact: true }),
        ).toBeVisible();
        await page
          .getByRole("button", { name: "Retry schedule change" })
          .click();
        await expect.poll(() => writes.length).toBe(7);
        expect(
          writes[6].rules.find((rule) => rule.activityId === "activity-2"),
        ).toMatchObject({ fixedStart: "12:15:00", duration: "PT60M" });
        await expect(
          calendar.getByRole("button", { name: "Cafe", exact: true }),
        ).toBeEnabled();
        const cancelBox = (await calendar
          .getByRole("button", { name: "Cafe", exact: true })
          .boundingBox())!;
        await page.mouse.move(cancelBox.x + 80, cancelBox.y + 20);
        await page.mouse.down();
        await page.mouse.move(cancelBox.x + 80, cancelBox.y + 50, { steps: 5 });
        await page.keyboard.press("Escape");
        await page.mouse.up();
        expect(writes).toHaveLength(7);
        await expect(page.getByRole("dialog")).toHaveCount(0);

        // Hovering day navigation while dragging transfers an event between visits.
        const source = (await calendar
          .getByRole("button", { name: "Cafe", exact: true })
          .boundingBox())!;
        const next = (await page
          .getByRole("button", { name: "Next day", exact: true })
          .boundingBox())!;
        await page.mouse.move(source.x + 80, source.y + 20);
        await page.mouse.down();
        await page.mouse.move(
          next.x + next.width / 2,
          next.y + next.height / 2,
          { steps: 10 },
        );
        await expect(
          page.getByRole("combobox", { name: "Calendar day" }),
        ).toHaveValue("visit-1:2027-06-15");
        const nextGrid = (await page
          .locator(".calendar-events")
          .boundingBox())!;
        // Preserve the 20px grab offset so the event starts at 09:00.
        await page.mouse.move(
          nextGrid.x + nextGrid.width / 2,
          nextGrid.y + 9 * 90 + 20,
          { steps: 10 },
        );
        const scrolledGrid = (await page
          .locator(".calendar-events")
          .boundingBox())!;
        await page.mouse.move(
          scrolledGrid.x + scrolledGrid.width / 2,
          scrolledGrid.y + 9 * 90 + 20,
        );
        await page.mouse.up();
        await expect.poll(() => writes.length).toBe(8);
        expect(writes[7].days[1].activityIds).toEqual(["activity-2"]);
        expect(writes[7].days[0].activityIds).not.toContain("activity-2");
        expect(
          writes[7].rules.find((rule) => rule.activityId === "activity-2"),
        ).toMatchObject({
          fixedDate: "2027-06-15",
          fixedStart: "09:00:00",
          duration: "PT60M",
        });
        await page
          .getByRole("button", { name: "Previous day", exact: true })
          .click();
        await page.screenshot({
          path: testInfo.outputPath("calendar-workspace.png"),
          fullPage: true,
        });
      }
      await page.context().setOffline(true);
      await calendar.evaluate((element) => {
        element.scrollTop = 7 * 90;
      });
      await page.getByRole("button", { name: "Museum", exact: true }).click();
      await expect(page.getByLabel("Event start", { exact: true })).toHaveValue(
        width >= 1100 ? "08:45" : "08:30",
      );
      await expect(
        page.getByLabel("Event start", { exact: true }),
      ).toBeDisabled();
      await expect(
        page.getByRole("button", { name: "Save", exact: true }),
      ).toHaveCount(0);
      await page.getByRole("button", { name: "Close", exact: true }).click();
      await page.getByRole("button", { name: "Next day", exact: true }).click();
      if (width < 1100)
        await expect(
          page.getByText("No events scheduled", { exact: true }),
        ).toBeVisible();
      else
        await expect(
          calendar.getByRole("button", { name: "Cafe", exact: true }),
        ).toBeVisible();
    });
  });
}
