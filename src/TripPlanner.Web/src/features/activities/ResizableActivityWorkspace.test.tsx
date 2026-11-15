import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ResizableActivityWorkspace from "./ResizableActivityWorkspace";

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 1024, 600),
  );
});
afterEach(() => vi.restoreAllMocks());

function show() {
  render(
    <ResizableActivityWorkspace mapPanelId="map">
      <section>Daily plan</section>
      <div id="map">Map</div>
    </ResizableActivityWorkspace>,
  );
  return screen.getByRole("separator", { name: "Resize plan and map" });
}

it("resizes both columns with the keyboard while keeping usable minimum widths", () => {
  const handle = show();
  expect(handle).toHaveAttribute("aria-valuenow", "40");
  fireEvent.keyDown(handle, { key: "ArrowRight" });
  expect(handle).toHaveAttribute("aria-valuenow", "45");
  expect(
    handle.parentElement?.style.getPropertyValue("--activity-plan-track"),
  ).toBe("45fr");
  expect(
    handle.parentElement?.style.getPropertyValue("--activity-map-track"),
  ).toBe("55fr");
  fireEvent.keyDown(handle, { key: "End" });
  fireEvent.keyDown(handle, { key: "ArrowRight" });
  expect(handle).toHaveAttribute("aria-valuenow", "74");
  fireEvent.keyDown(handle, { key: "Home" });
  fireEvent.keyDown(handle, { key: "ArrowLeft" });
  expect(handle).toHaveAttribute("aria-valuenow", "26");
  expect(screen.getByText("Daily plan")).toBeVisible();
  expect(screen.getByText("Map")).toBeVisible();
});

it.each(["mouse", "touch"])(
  "captures a %s drag and stops resizing when released",
  (pointerType) => {
    const handle = show();
    handle.setPointerCapture = vi.fn();
    handle.releasePointerCapture = vi.fn();
    fireEvent.pointerDown(handle, {
      pointerId: 1,
      pointerType,
      button: 0,
      clientX: 400,
    });
    fireEvent.pointerMove(handle, { pointerId: 1, pointerType, clientX: 600 });
    expect(handle.setPointerCapture).toHaveBeenCalledWith(1);
    expect(handle).toHaveAttribute("aria-valuenow", "60");
    fireEvent.pointerMove(handle, { pointerId: 1, pointerType, clientX: 2000 });
    expect(handle).toHaveAttribute("aria-valuenow", "74");
    fireEvent.pointerUp(handle, { pointerId: 1, pointerType });
    expect(handle.releasePointerCapture).toHaveBeenCalledWith(1);
    fireEvent.pointerMove(handle, { pointerId: 1, pointerType, clientX: 400 });
    expect(handle).toHaveAttribute("aria-valuenow", "74");
    expect(handle.parentElement).not.toHaveClass("is-resizing");
  },
);
