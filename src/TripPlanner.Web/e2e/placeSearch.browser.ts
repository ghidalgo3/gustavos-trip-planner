import { test, expect, type Locator } from "@playwright/test";
import fixtures from "./fixtures.json" with { type: "json" };

async function resultStyles(result: Locator) {
  return result.evaluate((element) => {
    const style = getComputedStyle(element);
    const name = getComputedStyle(
      element.querySelector(".place-search-result-name")!,
    );
    const address = getComputedStyle(
      element.querySelector(".place-search-result-address")!,
    );
    return {
      padding: style.padding,
      gap: style.gap,
      radius: style.borderRadius,
      background: style.backgroundColor,
      font: name.fontSize,
      weight: name.fontWeight,
      addressFont: address.fontSize,
      addressColor: address.color,
    };
  });
}

for (const width of [320, 390, 1280]) {
  for (const colorScheme of ["light", "dark"] as const) {
    test.describe(`place searches at ${width}px in ${colorScheme}`, () => {
      test.use({
        viewport: { width, height: 844 },
        colorScheme,
        reducedMotion: "reduce",
        serviceWorkers: "block",
      });

      test("shares numbered results and saves stays from the drawer map and list", async ({
        page,
        request,
      }, testInfo) => {
        await request.post("/__test/session", {
          data: { authenticated: true },
        });
        // Keep the real map component and markers; replace only the external SDK.
        await page.addInitScript(() => {
          class HtmlMarker {
            element: HTMLElement;
            constructor(options: {
              htmlContent: HTMLElement;
              position: number[];
            }) {
              this.element = options.htmlContent;
              this.element.dataset.coordinates = options.position.join(",");
            }
          }
          class Map {
            constructor(private container: HTMLElement) {}
            events = {
              add: (name: string, callback: (event: object) => void) => {
                if (name === "ready") queueMicrotask(() => callback({}));
              },
            };
            markers = {
              add: (marker: HtmlMarker) => {
                marker.element.style.position = "relative";
                marker.element.style.margin = "160px 12px 0";
                this.container.append(marker.element);
              },
              remove: (marker: HtmlMarker) => marker.element.remove(),
            };
            sources = { add() {}, remove() {} };
            layers = { add() {}, remove() {} };
            setCamera = (options: object) => {
              this.container.dataset.camera = JSON.stringify(options);
            };
            getCamera = () => ({ center: [139.69, 35.68], zoom: 11 });
            setStyle() {}
            stop() {}
            resize() {}
            dispose() {}
          }
          Object.assign(window, {
            atlas: {
              Map,
              HtmlMarker,
              source: {
                DataSource: class {
                  add() {}
                },
              },
              layer: { LineLayer: class {} },
            },
          });
        });
        await page.route("**/mapToken", (route) =>
          route.fulfill({
            json: {
              token: "test",
              endpoint: "https://places.example.test",
              expiresAt: "2099-01-01T00:00:00Z",
            },
          }),
        );
        await page.route("https://places.example.test/**", (route) =>
          route.fulfill({
            json: {
              results: [
                {
                  id: "hotel-1",
                  poi: { name: "Tokyo hotel" },
                  address: {
                    freeformAddress: "1 Hotel street, Tokyo",
                    countryCode: "JP",
                  },
                  position: { lon: 139.7, lat: 35.69 },
                },
                {
                  id: "hotel-2",
                  poi: { name: "Tokyo garden hotel" },
                  address: {
                    freeformAddress: "2 Garden street, Tokyo",
                    countryCode: "JP",
                  },
                  position: { lon: 139.72, lat: 35.71 },
                },
              ],
            },
          }),
        );
        const prefix = `/trips/${fixtures.trip.id}`;
        await page.goto(`${prefix}/activities`);
        await page
          .getByRole("button", { name: "Add activity", exact: true })
          .click();
        const activityDrawer = page.getByRole("dialog", {
          name: "Add activity",
          exact: true,
        });
        await activityDrawer
          .getByRole("searchbox", { name: "Find a place", exact: true })
          .fill("Tokyo hotel");
        await activityDrawer
          .getByRole("button", { name: "Search places", exact: true })
          .click();
        const activityResult = activityDrawer.getByRole("button", {
          name: "1. Tokyo hotel, 1 Hotel street, Tokyo",
          exact: true,
        });
        await expect(activityResult).toBeVisible();
        await page.mouse.move(0, 0);
        const activityStyles = await resultStyles(activityResult);
        await page.goto(prefix);
        await page
          .getByRole("button", { name: /Choose stay in Tokyo/ })
          .first()
          .click();
        const drawer = page.getByRole("dialog", {
          name: "Stay in Tokyo",
          exact: true,
        });
        const search = drawer.getByRole("searchbox", {
          name: "Stay location",
          exact: true,
        });
        await search.fill("Tokyo hotel");
        expect(
          await search.evaluate((element) =>
            parseFloat(getComputedStyle(element).fontSize),
          ),
        ).toBeGreaterThanOrEqual(16);
        await drawer
          .getByRole("button", { name: "Search", exact: true })
          .click();
        const result = drawer.getByRole("button", {
          name: "1. Tokyo hotel, 1 Hotel street, Tokyo",
          exact: true,
        });
        await expect(result).toBeVisible();
        await page.mouse.move(0, 0);
        expect(await resultStyles(result)).toEqual(activityStyles);
        expect((await result.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        const group = drawer.getByRole("group", {
          name: "Matching stays",
          exact: true,
        });
        expect(
          Math.abs(
            (await group.boundingBox())!.width -
              (await result.boundingBox())!.width,
          ),
        ).toBeLessThanOrEqual(1);
        const map = drawer.getByRole("img", {
          name: "Map of Tokyo",
          exact: true,
        });
        const pin = map.getByRole("button", {
          name: "Select Tokyo garden hotel, 2 Garden street, Tokyo",
          exact: true,
        });
        await expect(pin).toHaveText("2");
        await expect(pin).toHaveAttribute("data-coordinates", "139.72,35.71");
        await expect(map.getByRole("button")).toHaveCount(2);
        await expect(map).toHaveAttribute(
          "data-camera",
          /139\.7,35\.69,139\.72,35\.71/,
        );
        const saves: unknown[] = [];
        await page.route(
          `**${prefix}/destinations/*/stays/*/location`,
          async (route) => {
            saves.push(route.request().postDataJSON());
            await route.fulfill({ status: 204 });
          },
        );
        await pin.click();
        await expect(
          drawer.getByRole("button", {
            name: "2. Tokyo garden hotel, 2 Garden street, Tokyo",
            exact: true,
          }),
        ).toHaveAttribute("aria-pressed", "true");
        expect(saves[0]).toMatchObject({
          geometry: { coordinates: [139.72, 35.71] },
          properties: { name: "Tokyo garden hotel" },
        });
        await result.click();
        await expect(result).toHaveAttribute("aria-pressed", "true");
        await expect(map).toBeVisible();
        expect(saves[1]).toMatchObject({
          geometry: { coordinates: [139.7, 35.69] },
          properties: { name: "Tokyo hotel" },
        });
        await drawer.screenshot({
          path: testInfo.outputPath("stay-place-results.png"),
          animations: "disabled",
        });
        expect(
          await drawer.evaluate(
            (element) => element.scrollWidth - element.clientWidth,
          ),
        ).toBeLessThanOrEqual(1);
        await search.fill("Another hotel");
        await expect(
          drawer.getByRole("group", { name: "Matching stays" }),
        ).toHaveCount(0);
        await expect(
          drawer.locator(".activity-map-marker:not(.activity-map-stay)"),
        ).toHaveCount(0);
        await expect(
          drawer.getByRole("button", {
            name: "Stay: Tokyo hotel",
            exact: true,
          }),
        ).toBeVisible();
        expect(saves).toHaveLength(2);
      });
    });
  }
}
