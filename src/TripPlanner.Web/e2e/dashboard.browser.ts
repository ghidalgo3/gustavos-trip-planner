import { test, expect } from "@playwright/test";
import fixtures from "./fixtures.json" with { type: "json" };

for (const width of [390, 1280]) {
  test.describe(`trip dashboard at ${width}px`, () => {
    // Keep mocked API requests in the page; offline tests cover the service worker.
    test.use({ viewport: { width, height: 844 }, serviceWorkers: "block" });

    test("pages a thousand trips, shows dates, and searches upcoming and past trips", async ({
      page,
      request,
    }, testInfo) => {
      await request.post("/__test/session", {
        data: { authenticated: true, selection: "complete" },
      });
      const catalog = Array.from({ length: 1000 }, (_, index) => ({
        ...fixtures.trip,
        id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        name:
          index === 0
            ? "Next adventure"
            : `Trip ${String(index).padStart(4, "0")}`,
        description: "",
        startDate: index === 0 ? "2090-01-02" : null,
        endDate: index === 0 ? "2090-01-04" : null,
      }));
      catalog.push({
        ...catalog[0],
        id: "00000000-0000-4000-8000-000000001001",
        name: "Past adventure",
        startDate: "2000-01-02",
        endDate: "2000-01-04",
      });
      const requests: URLSearchParams[] = [];
      await page.route("**/user/*/trips?*", async (route) => {
        const query = new URL(route.request().url()).searchParams;
        requests.push(query);
        const past = query.get("past") === "true";
        const matching = catalog.filter(
          (trip) =>
            (!!trip.endDate && trip.endDate < query.get("today")!) === past &&
            trip.name
              .toLowerCase()
              .includes(query.get("search")!.toLowerCase()),
        );
        const skip = Number(query.get("skip"));
        await route.fulfill({
          json: {
            trips: matching.slice(skip, skip + 10),
            hasMore: matching.length > skip + 10,
          },
        });
      });
      await page.goto("/");
      await expect(page.getByRole("link", { name: /^Open trip:/ })).toHaveCount(
        10,
      );
      await expect(page.getByText(/Jan 2, 2090.*Jan 4, 2090/)).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Past trips", exact: true }),
      ).toHaveAttribute("aria-expanded", "false");
      expect(requests).toHaveLength(1);
      await expect(
        page.getByText(/Available offline|Welcome back|YOUR TRIPS/),
      ).toHaveCount(0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath("dashboard.png"),
        fullPage: true,
      });

      await page
        .getByRole("button", { name: "Load more", exact: true })
        .click();
      await expect(page.getByRole("link", { name: /^Open trip:/ })).toHaveCount(
        20,
      );
      expect(requests[1].get("skip")).toBe("10");
      await page
        .getByRole("searchbox", { name: "Search trips" })
        .fill("TRIP 0999");
      await expect(
        page.getByRole("heading", { name: "Trip 0999" }),
      ).toBeVisible();
      await expect(page.getByRole("link", { name: /^Open trip:/ })).toHaveCount(
        1,
      );
      expect(
        requests
          .filter((query) => query.get("search") === "TRIP 0999")
          .every((query) => query.get("skip") === "0"),
      ).toBe(true);
      await page
        .getByRole("searchbox", { name: "Search trips" })
        .fill("Past adventure");
      await expect(
        page.getByRole("heading", { name: "Past adventure" }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Past trips", exact: true }),
      ).toHaveAttribute("aria-expanded", "true");
      await expect(page.getByText(/Jan 2, 2000.*Jan 4, 2000/)).toBeVisible();
    });
  });
}
