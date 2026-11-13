import { test, expect } from "@playwright/test";
import fixtures from "./fixtures.json" with { type: "json" };

for (const width of [320, 390, 1280]) {
  test.describe(`activity drawer at ${width}px`, () => {
    test.use({ viewport: { width, height: 844 }, serviceWorkers: "block" });

    test("keeps balanced gutters and fits Description and Notes to their text", async ({
      page,
      request,
    }, testInfo) => {
      await request.post("/__test/session", { data: { authenticated: true } });
      await page.goto(`/trips/${fixtures.trip.id}/activities`);
      await page
        .getByRole("button", { name: "Add activity", exact: true })
        .click();
      const drawer = page.getByRole("dialog", {
        name: "Add activity",
        exact: true,
      });
      await expect(drawer).toBeVisible();
      await drawer.evaluate((element) =>
        Promise.all(
          element
            .getAnimations({ subtree: true })
            .map((animation) => animation.finished),
        ),
      );
      for (const label of ["Description", "Notes"]) {
        const field = drawer.getByRole("textbox", {
          name: label,
          exact: true,
        });
        const initialHeight = (await field.boundingBox())!.height;
        const longText = Array.from(
          { length: 12 },
          (_, i) =>
            `Paragraph ${i + 1}: Explore the museum and its collections at a relaxed pace.`,
        ).join("\n");
        await field.fill(longText);
        await expect
          .poll(async () => (await field.boundingBox())!.height)
          .toBeGreaterThan(initialHeight);
        expect(
          await field.evaluate(
            (element) => element.scrollHeight <= element.clientHeight + 1,
          ),
        ).toBe(true);
        await field.fill("Short text.");
        await expect
          .poll(async () => (await field.boundingBox())!.height)
          .toBe(initialHeight);
      }
      const layout = await drawer.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const input = element
          .querySelector<HTMLElement>(".fui-SearchBox")!
          .getBoundingClientRect();
        return {
          width: bounds.width,
          overflow: element.scrollWidth - element.clientWidth,
          left: input.left - bounds.left,
          right: bounds.right - input.right,
        };
      });
      expect(layout.width).toBeLessThanOrEqual(width);
      expect(layout.overflow).toBeLessThanOrEqual(1);
      expect(Math.abs(layout.left - layout.right)).toBeLessThanOrEqual(1);
      await drawer.screenshot({
        path: testInfo.outputPath("activity-drawer.png"),
      });
    });
  });
}
