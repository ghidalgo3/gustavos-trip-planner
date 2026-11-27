import { expect, test } from "@playwright/test";
import fixtures from "./fixtures.json" with { type: "json" };

test.use({
  viewport: { width: 390, height: 844 },
  reducedMotion: "reduce",
  serviceWorkers: "block",
});

test("uses OpenStreetMap with working pins and routes in South Korea", async ({
  page,
  request,
}) => {
  await request.post("/__test/session", { data: { authenticated: true } });
  const prefix = `/trips/${fixtures.trip.id}`;
  const seoul = [126.98, 37.57];
  const busan = [129.08, 35.18];
  await page.route(`**${prefix}/document`, async (route) => {
    const response = await route.fetch();
    const document = await response.json();
    for (const [id, name, coordinates, start, end] of [
      ["seoul", "Seoul", seoul, "2030-04-10", "2030-04-13"],
      ["busan", "Busan", busan, "2030-04-13", "2030-04-15"],
    ] as const) {
      document.places.push({
        id,
        name,
        type: "Place",
        destinationId: id,
        countryCode: "KR",
        timeZone: "Asia/Seoul",
        active: true,
        etag: "1",
        activitiesEtag: "1",
        location: { type: "Point", coordinates },
      });
      document.itinerary.items.push({
        id: `${id}-visit`,
        order: document.itinerary.items.length,
        kind: "visit",
        type: "event",
        name,
        busy: false,
        start,
        end,
        destinationId: id,
        placeId: id,
      });
      document.preferences.destinations.push({ destinationId: id });
    }
    document.places.push({
      id: "palace",
      type: "Place",
      name: "Gyeongbokgung Palace",
      location: { type: "Point", coordinates: [126.977, 37.579] },
    });
    document.itinerary.items.push(
      {
        id: "palace-visit",
        kind: "activity",
        type: "task",
        busy: false,
        name: "Gyeongbokgung Palace",
        destinationId: "seoul",
        placeId: "palace",
        state: "Maybe",
        kinds: [],
        links: [],
        ticketRequirement: "Unknown",
      },
      {
        id: "ktx",
        kind: "transportation",
        type: "task",
        busy: false,
        name: "KTX",
        transportation: {
          id: "ktx",
          type: "FeatureCollection",
          name: "KTX",
          notes: "",
          mode: "train",
          originStayId: "seoul-visit",
          destinationStayId: "busan-visit",
          features: [
            {
              id: "from",
              geometry: null,
              properties: { name: "Seoul Station" },
            },
            { id: "to", geometry: null, properties: { name: "Busan Station" } },
            {
              id: "route",
              geometry: { type: "LineString", coordinates: [seoul, busan] },
            },
          ],
        },
      },
    );
    await route.fulfill({ json: document });
  });

  let rejectTiles = true;
  await page.route("https://tile.openstreetmap.org/**", (route) =>
    rejectTiles
      ? route.abort()
      : route.fulfill({
          contentType: "image/svg+xml",
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"/>',
        }),
  );
  let azureTokenRequests = 0;
  await page.route("**/mapToken", (route) => {
    azureTokenRequests++;
    return route.fulfill({ status: 503, json: {} });
  });
  await page.route("https://atlas.microsoft.com/sdk/**", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: route.request().url().endsWith(".js") ? "window.atlas = {};" : "",
    }),
  );

  await page.goto(`${prefix}/activities?destination=seoul`);
  const seoulMap = page.getByRole("region", { name: "Map of Seoul" });
  await expect(page.getByText("Map tiles could not be loaded.")).toBeVisible();
  rejectTiles = false;
  await page.getByRole("button", { name: "Retry map" }).click();
  await expect(seoulMap).toHaveAttribute("aria-busy", "false");
  await expect(
    seoulMap.getByRole("link", { name: "OpenStreetMap contributors" }),
  ).toBeVisible();
  const palace = seoulMap.getByRole("button", {
    name: "Select Gyeongbokgung Palace",
  });
  await expect(palace).toHaveText("1");
  const pinSize = await palace.boundingBox();
  expect(pinSize?.width).toBeGreaterThanOrEqual(44);
  expect(pinSize?.height).toBeGreaterThanOrEqual(44);
  await palace.click();
  await expect(palace).toHaveAttribute("data-selected", "true");
  await seoulMap
    .getByRole("link", { name: "OpenStreetMap contributors" })
    .click({ trial: true, timeout: 4_000 });

  await page.goto(prefix);
  await page.getByRole("button", { name: "Choose stay in Seoul" }).click();
  const stayDrawer = page.getByRole("dialog", { name: "Stay in Seoul" });
  await expect(
    stayDrawer.getByRole("region", { name: "Map of Seoul" }),
  ).toHaveAttribute("aria-busy", "false");
  await stayDrawer.getByRole("button", { name: "Close Stay drawer" }).click();
  await page.getByRole("button", { name: /Seoul → Busan/ }).click();
  const transportMap = page.getByRole("region", {
    name: "Map of Seoul to Busan",
  });
  await expect(
    transportMap.locator(".leaflet-overlay-pane path"),
  ).toBeVisible();
  expect(azureTokenRequests).toBe(0);

  await page.goto(`${prefix}/activities?destination=seoul`);
  await expect(seoulMap).toHaveAttribute("aria-busy", "false");
  await page.getByRole("tab", { name: /^Tokyo / }).click();
  await expect(page.getByRole("img", { name: "Map of Tokyo" })).toBeVisible();
  await expect(seoulMap).toHaveCount(0);
  await expect.poll(() => azureTokenRequests).toBe(1);
});
