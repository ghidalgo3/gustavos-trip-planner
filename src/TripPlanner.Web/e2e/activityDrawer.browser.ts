import { test, expect } from "@playwright/test";
import fixtures from "./fixtures.json" with { type: "json" };

for (const width of [320, 390, 1280]) {
  test.describe(`activity drawer at ${width}px`, () => {
    test.use({ viewport: { width, height: 844 }, serviceWorkers: "block" });

    test("autocompletes known kinds with the keyboard and preserves new labels", async ({
      page,
      request,
    }, testInfo) => {
      await request.post("/__test/session", { data: { authenticated: true } });
      await page.route("**/user/activity-kinds?**", async (route) => {
        const search =
          new URL(route.request().url()).searchParams.get("search") ?? "";
        await route.fulfill({
          json: {
            kinds: ["Architecture", "Art"].filter((kind) =>
              kind.toLowerCase().includes(search.toLowerCase()),
            ),
            hasMore: false,
          },
        });
      });
      await page.goto(`/trips/${fixtures.trip.id}/activities`);
      await page
        .getByRole("button", { name: "Add activity", exact: true })
        .click();
      const drawer = page.getByRole("dialog", {
        name: "Add activity",
        exact: true,
      });
      const input = drawer.getByRole("combobox", {
        name: "Kinds",
        exact: true,
      });
      await expect(input).not.toHaveAttribute("aria-required", "true");
      expect(
        await input.evaluate((element) =>
          parseFloat(getComputedStyle(element).fontSize),
        ),
      ).toBeGreaterThanOrEqual(16);
      await drawer
        .getByLabel("Activity name", { exact: true })
        .fill("Photo walk");
      await expect(
        drawer.getByRole("button", { name: "Save activity", exact: true }),
      ).toBeEnabled();
      await input.fill("arch");
      await expect(
        page.getByRole("menuitemcheckbox", {
          name: "Architecture",
          exact: true,
        }),
      ).toBeVisible();
      await input.press("ArrowDown");
      await input.press("Enter");
      await expect(
        drawer.getByLabel("Remove Architecture", { exact: true }),
      ).toBeVisible();
      await expect(input).toHaveValue("");
      await input.fill("Street photography");
      await drawer
        .getByLabel("Activity name", { exact: true })
        .fill("Photo walk");
      await expect(
        drawer.getByLabel("Remove Street photography", { exact: true }),
      ).toBeVisible();
      await expect(input).toHaveValue("");
      await input.fill("A".repeat(200));
      await input.press("Enter");
      await expect(
        drawer.getByLabel(`Remove ${"A".repeat(200)}`, { exact: true }),
      ).toBeVisible();
      const longText = drawer
        .getByLabel(`Remove ${"A".repeat(200)}`, { exact: true })
        .locator(".fui-Tag__primaryText");
      expect(
        await longText.evaluate(
          (element) => element.scrollWidth - element.clientWidth,
        ),
      ).toBeLessThanOrEqual(1);
      await drawer
        .getByLabel(`Remove ${"A".repeat(200)}`, { exact: true })
        .click();
      await input.fill("Shopping");
      await input.press("Enter");
      await expect(
        drawer.getByLabel("Remove Shopping", { exact: true }),
      ).toBeVisible();
      await drawer.locator(".activity-kinds-picker").scrollIntoViewIfNeeded();
      const tags = drawer.getByRole("toolbar", { name: "Selected kinds" });
      const tagBounds = (await tags.boundingBox())!;
      expect(tagBounds.y + tagBounds.height).toBeLessThanOrEqual(
        (await input.boundingBox())!.y,
      );
      expect(
        (await drawer
          .locator(".activity-kinds-picker .fui-Field__label")
          .boundingBox())!.height,
      ).toBeLessThanOrEqual(24);
      const fits = await drawer
        .locator(".activity-kinds-control")
        .evaluate((control) => {
          const bounds = control.getBoundingClientRect();
          return Array.from(
            control.querySelectorAll(".activity-kind-tag"),
          ).every((tag) => {
            const rect = tag.getBoundingClientRect();
            return rect.left >= bounds.left && rect.right <= bounds.right + 1;
          });
        });
      expect(fits).toBe(true);
      await drawer.screenshot({
        path: testInfo.outputPath("activity-kinds.png"),
      });
      await expect(
        drawer.getByRole("button", { name: "Save activity", exact: true }),
      ).toBeEnabled();
      expect(
        await drawer.evaluate(
          (element) => element.scrollWidth - element.clientWidth,
        ),
      ).toBeLessThanOrEqual(1);
      for (const kind of ["Architecture", "Street photography", "Shopping"]) {
        await drawer.getByLabel(`Remove ${kind}`, { exact: true }).click();
      }
      await expect(
        drawer.getByRole("toolbar", { name: "Selected kinds" }),
      ).toHaveCount(0);
      await expect(
        drawer.getByRole("button", { name: "Save activity", exact: true }),
      ).toBeEnabled();
    });

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
