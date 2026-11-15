import { test, expect } from "@playwright/test";
import fixtures from "./fixtures.json" with { type: "json" };

for (const width of [390, 1280]) {
  test.describe(`map motion at ${width}px`, () => {
    test.use({
      viewport: { width, height: 844 },
      colorScheme: "dark",
      serviceWorkers: "block",
    });

    test("destination flights use adaptive framing and 1.5-second sine easing without tuning controls", async ({
      page,
      request,
    }) => {
      await request.post("/__test/session", { data: { authenticated: true } });
      // Exercise the real map component and frame controller through the public SDK interface.
      await page.addInitScript(() => {
        const frames: { center: number[]; zoom: number; time: number }[] = [];
        Object.assign(window, { mapMotionFrames: frames });
        class Map {
          camera: { center: number[]; zoom: number };
          constructor(
            _container: HTMLElement,
            options: { center: number[]; zoom: number },
          ) {
            this.camera = { center: options.center, zoom: options.zoom };
          }
          events = {
            add: (name: string, callback: (event: object) => void) => {
              if (name === "ready") queueMicrotask(() => callback({}));
            },
          };
          markers = { add: () => {}, remove: () => {} };
          sources = { add: () => {}, remove: () => {} };
          layers = { add: () => {}, remove: () => {} };
          getCamera = () => this.camera;
          setCamera = (options: {
            center?: number[];
            zoom?: number;
            bounds?: number[];
            maxZoom?: number;
          }) => {
            const center =
              options.center ??
              (options.bounds
                ? [
                    (options.bounds[0] + options.bounds[2]) / 2,
                    (options.bounds[1] + options.bounds[3]) / 2,
                  ]
                : this.camera.center);
            this.camera = {
              center,
              zoom: options.zoom ?? options.maxZoom ?? this.camera.zoom,
            };
            frames.push({ ...this.camera, time: performance.now() });
          };
          setStyle() {}
          stop() {}
          resize() {}
          dispose() {}
        }
        Object.assign(window, {
          atlas: {
            Map,
            HtmlMarker: class {},
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
            endpoint: "https://atlas.example.test",
            expiresAt: "2099-01-01T00:00:00Z",
          },
        }),
      );
      await page.route(
        `**/trips/${fixtures.trip.id}/document`,
        async (route) => {
          const response = await route.fetch();
          const document = await response.json();
          document.places.push({
            id: "london",
            name: "London",
            type: "Place",
            destinationId: "london",
            countryCode: "GB",
            timeZone: "Europe/London",
            active: true,
            etag: "1",
            activitiesEtag: "1",
            location: { type: "Point", coordinates: [-0.12, 51.5] },
          });
          document.itinerary.items.push({
            id: "london-visit",
            order: 1,
            kind: "visit",
            type: "event",
            name: "London",
            busy: false,
            start: "2030-04-10",
            end: "2030-04-15",
            destinationId: "london",
            placeId: "london",
          });
          document.preferences.destinations.push({
            destinationId: "london",
            constraints: {},
            activities: { instructions: "", defaults: null },
            schedule: {},
          });
          await route.fulfill({ json: document });
        },
      );
      await page.goto(`/trips/${fixtures.trip.id}/activities`);
      await expect(
        page.getByRole("img", { name: "Map of Tokyo" }),
      ).toHaveAttribute("aria-busy", "false");
      await expect(
        page.getByRole("slider", { name: "Map animation duration" }),
      ).toHaveCount(0);

      const duration = 1500;
      for (const [destination, longitude] of [
        ["London", -0.12],
        ["Tokyo", 139.76],
      ] as const) {
        await page.evaluate(() => {
          (
            window as unknown as { mapMotionFrames: unknown[] }
          ).mapMotionFrames.length = 0;
        });
        await page
          .getByRole("tab", { name: new RegExp(`^${destination} `) })
          .click();
        await expect
          .poll(() =>
            page.evaluate((longitude) => {
              const frame = (
                window as unknown as {
                  mapMotionFrames: { center: number[]; zoom: number }[];
                }
              ).mapMotionFrames.at(-1);
              return Boolean(
                frame &&
                Math.abs(frame.center[0] - longitude) < 0.001 &&
                Math.abs(frame.zoom - 11) < 0.001,
              );
            }, longitude),
          )
          .toBe(true);
        const frames = await page.evaluate(
          () =>
            (
              window as unknown as {
                mapMotionFrames: {
                  center: number[];
                  zoom: number;
                  time: number;
                }[];
              }
            ).mapMotionFrames,
        );
        expect(frames.length).toBeGreaterThan(10);
        expect(frames.at(-1)!.time - frames[0].time).toBeGreaterThanOrEqual(
          duration - 20,
        );
        expect(frames.at(-1)!.time - frames[0].time).toBeLessThan(
          duration + 250,
        );
        const minimum = Math.min(...frames.map((frame) => frame.zoom));
        expect(minimum).toBeLessThan(5);
        expect(minimum).toBeGreaterThan(0);
        const early = frames.find(
          (frame) => frame.time - frames[0].time >= duration * 0.12,
        )!;
        expect(early.center).not.toEqual(frames[0].center);
        expect(early.zoom).toBeLessThan(frames[0].zoom);
        const late = frames.find(
          (frame) => frame.time - frames[0].time >= duration * 0.88,
        )!;
        expect(late.center).not.toEqual(frames.at(-1)!.center);
        expect(late.zoom).toBeLessThan(frames.at(-1)!.zoom);
        expect(frames.at(-1)!.zoom).toBeGreaterThan(minimum);
      }
      if (width < 768) {
        await page
          .getByRole("button", { name: "Explore map full screen" })
          .click();
        const fullscreen = page.getByRole("dialog", { name: "Map of Tokyo" });
        await expect(fullscreen).toBeVisible();
        await expect(
          fullscreen.getByRole("slider", { name: "Map animation duration" }),
        ).toHaveCount(0);
        await page
          .getByRole("button", { name: "Exit full-screen map" })
          .click();
      }
    });
  });
}
