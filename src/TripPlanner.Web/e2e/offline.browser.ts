import {
  test,
  expect,
  chromium,
  webkit,
  type BrowserContext,
} from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fixtures from "./fixtures.json" with { type: "json" };

const origin = "http://127.0.0.1:4174";
const { trip } = fixtures;

for (const selection of ["partial", "complete"]) {
  test(`a fresh browser process restores the saved account, trip and ${selection} flights offline`, async ({
    browserName,
    request,
  }, testInfo) => {
    const profile = await mkdtemp(join(tmpdir(), "tripplanner-offline-"));
    const engine = browserName === "webkit" ? webkit : chromium;
    const options = {
      headless: true,
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    };
    let context: BrowserContext | undefined;
    try {
      context = await engine.launchPersistentContext(profile, options);
      await request.post(`${origin}/__test/session`, {
        data: { authenticated: true, selection },
      });
      const page = await context.newPage();
      await page.goto(origin);
      await expect(
        page.getByRole("link", { name: `Open trip: ${trip.name}` }),
      ).toBeVisible();
      await expect(
        page.getByRole("img", { name: "Japan", exact: true }),
      ).toBeVisible();
      await page.getByRole("link", { name: `Open trip: ${trip.name}` }).click();
      await expect(
        page.getByRole("heading", { name: trip.name }),
      ).toBeVisible();
      await expect(
        page.getByRole("img", { name: "Japan", exact: true }),
      ).toBeVisible();
      await expect(
        page.locator(".overview-destination-heading .city-icon"),
      ).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath("online-trip-artwork.png"),
      });
      await expect
        .poll(() =>
          page.evaluate(
            async () =>
              (await navigator.serviceWorker.getRegistration())?.active?.state,
          ),
        )
        .toBe("activated");
      await expect
        .poll(() =>
          page.evaluate(
            async () =>
              !!(await caches.match("/index.html", {
                cacheName: "tripplanner-shell-v2",
              })),
          ),
        )
        .toBe(true);
      await page.locator(".overview-destination-link").first().press("Enter");
      const destinationTab = page.getByRole("tab", { name: /Tokyo/ });
      await expect(destinationTab.locator(".city-icon")).toBeVisible();
      await expect
        .poll(() =>
          destinationTab
            .locator(".city-icon")
            .evaluate(
              (element) => (element as SVGGraphicsElement).getBBox().width,
            ),
        )
        .toBeGreaterThan(0);
      await page.screenshot({
        path: testInfo.outputPath("online-destination-artwork.png"),
      });
      await page.getByRole("link", { name: "Overview", exact: true }).click();
      await page
        .locator(".overview-flight-spacer")
        .getByRole("link")
        .first()
        .click();
      await expect(
        page.getByRole("region", {
          name: "Flight destinations and connections",
        }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: /Choose flight JL 8/ }),
      ).toBeEnabled();
      await expect(
        page.getByRole("button", { name: /Choose flight JL 8/ }),
      ).toHaveAttribute("aria-pressed", "true");
      await page.screenshot({
        path: testInfo.outputPath("online-flights.png"),
        fullPage: true,
      });
      // Confirm the saved trip catalog before reopening the app offline.
      await page
        .getByRole("link", { name: "Trip Planner", exact: true })
        .click();
      await expect(
        page.getByRole("link", { name: `Open trip: ${trip.name}` }),
      ).toBeVisible();
      await context.close();

      // No sessionStorage, page memory, routes, or network from the online process.
      context = await engine.launchPersistentContext(profile, options);
      await context.setOffline(true);
      const offlinePage = await context.newPage();
      await offlinePage.clock.install({
        time: new Date("2030-01-01T00:00:00Z"),
      });
      await offlinePage.clock.pauseAt(new Date("2030-01-01T00:01:00Z"));
      await offlinePage.goto(origin);
      await expect(
        offlinePage.getByRole("region", { name: "Your trips" }),
      ).toBeVisible();
      await expect(
        offlinePage.getByRole("img", { name: "Japan", exact: true }),
      ).toBeVisible();
      await expect(
        offlinePage.getByRole("button", { name: "New trip" }),
      ).toBeDisabled();
      await expect(
        offlinePage.getByText("Offline · View only", { exact: true }),
      ).toHaveCount(0);
      await offlinePage.clock.fastForward(29_999);
      await expect(
        offlinePage.getByText("Offline · View only", { exact: true }),
      ).toHaveCount(0);
      await offlinePage.clock.fastForward(1);
      await expect(
        offlinePage.getByText("Offline · View only", { exact: true }),
      ).toHaveCount(1);
      const offlineNotice = offlinePage.locator(".offline-notice");
      await expect(offlineNotice).toHaveCount(1);
      expect((await offlineNotice.boundingBox())!.height).toBeLessThanOrEqual(
        44,
      );
      await expect(
        offlinePage.getByRole("link", { name: `Open trip: ${trip.name}` }),
      ).toBeVisible();
      await offlinePage.screenshot({
        path: testInfo.outputPath("offline-catalog.png"),
      });
      await offlinePage
        .getByRole("link", { name: `Open trip: ${trip.name}` })
        .click();
      await expect(
        offlinePage.getByRole("heading", { name: trip.name }),
      ).toBeVisible();
      await expect(
        offlinePage.getByText("Offline · View only", { exact: true }),
      ).toBeVisible();
      await expect(
        offlinePage.getByRole("img", { name: "Japan", exact: true }),
      ).toBeVisible();
      const cityIcon = offlinePage.locator(
        ".overview-destination-heading .city-icon",
      );
      await expect(cityIcon).toBeVisible();
      // Confirm external SVG symbols have rendered geometry while disconnected.
      await expect
        .poll(() =>
          cityIcon.evaluate(
            (element) => (element as SVGGraphicsElement).getBBox().width,
          ),
        )
        .toBeGreaterThan(0);
      await expect(
        offlinePage.getByRole("button", { name: "Add destination" }),
      ).toHaveCount(0);
      await offlinePage.reload();
      await expect(
        offlinePage.getByRole("heading", { name: trip.name }),
      ).toBeVisible();

      await expect(
        offlinePage.getByText("Offline · View only", { exact: true }),
      ).toHaveCount(0);
      await offlinePage.clock.fastForward(30_000);
      await expect(
        offlinePage.getByRole("button", { name: "Retry connection" }),
      ).toBeVisible();
      await offlinePage
        .getByRole("button", { name: "Retry connection" })
        .click();
      await offlinePage.screenshot({
        path: testInfo.outputPath("offline-trip.png"),
      });
      await expect(
        offlinePage.getByRole("link", { name: "JL 8", exact: true }),
      ).toBeVisible();
      await offlinePage
        .locator(".overview-flight-spacer")
        .getByRole("link")
        .first()
        .click();
      const grid = offlinePage.getByRole("region", {
        name: "Flight destinations and connections",
      });
      const outbound = offlinePage.getByRole("button", {
        name: /Choose flight JL 8/,
      });
      await expect(grid).toBeVisible();
      await expect(
        offlinePage.getByRole("heading", { name: "Tokyo", exact: true }),
      ).toBeVisible();
      await expect(outbound).toHaveAttribute("aria-pressed", "true");
      await expect(outbound).toBeDisabled();
      await expect(
        offlinePage.getByRole("button", { name: "Find flights", exact: true }),
      ).toBeDisabled();
      await expect(
        offlinePage.getByRole("button", {
          name: "Clear selections",
          exact: true,
        }),
      ).toBeDisabled();
      await expect(
        offlinePage
          .getByRole("button", { name: "Booking Link", exact: true })
          .first(),
      ).toBeDisabled();
      await expect(
        offlinePage
          .getByRole("switch", { name: "Booked", exact: true })
          .first(),
      ).toBeChecked();
      for (const control of await offlinePage
        .getByRole("switch", { name: "Booked", exact: true })
        .all()) {
        await expect(control).toBeDisabled();
      }
      await expect(
        offlinePage.getByRole("combobox", { name: "Allowed stops" }),
      ).toBeEnabled();
      await offlinePage
        .getByText("Flight details", { exact: true })
        .first()
        .click();
      await expect(offlinePage.locator("details[open]")).toHaveCount(1);
      await offlinePage.reload();
      await expect(grid).toBeVisible();
      await expect(outbound).toHaveAttribute("aria-pressed", "true");
      await expect(outbound).toBeDisabled();
      await offlinePage.screenshot({
        path: testInfo.outputPath("offline-flights.png"),
        fullPage: true,
      });

      // Reconnection checks the real session; rejection discards cached identity/data.
      await request.post(`${origin}/__test/session`, {
        data: { authenticated: false },
      });
      await context.setOffline(false);
      // Drive the browser's reconnect notification, without racing a button
      // that disappears as soon as the automatic sign-in check finishes.
      await offlinePage.evaluate(() =>
        window.dispatchEvent(new Event("online")),
      );
      await expect(
        offlinePage.getByRole("link", { name: "Sign in with Google" }),
      ).toBeVisible();
      await expect
        .poll(() =>
          offlinePage.evaluate(() =>
            Object.keys(localStorage).filter((key) =>
              /tripplanner\.(offline-user|trip-catalog|document)/.test(key),
            ),
          ),
        )
        .toEqual([]);
    } finally {
      await context?.close();
      await rm(profile, { recursive: true, force: true });
    }
  });
}
