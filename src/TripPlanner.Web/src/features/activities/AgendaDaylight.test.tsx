import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { addDaylightDividers } from "./AgendaDaylight";

const date = "2026-12-04";
const location = {
  latitude: 43.0618,
  longitude: 141.3545,
  timeZone: "Asia/Tokyo",
};
const items = [
  <li key="wake" data-agenda-time={`${date}T07:00`}>
    Wake up
  </li>,
  <li
    key="breakfast"
    data-order-meal="breakfast"
    data-agenda-time={`${date}T07:00`}
  >
    Breakfast
  </li>,
  <li key="museum" data-order-index={0} data-agenda-time={`${date}T14:00`}>
    Museum · 180 min
  </li>,
  <li key="dinner" data-order-meal="dinner" data-agenda-time={`${date}T19:00`}>
    Dinner
  </li>,
];

test("inserts small chronological dividers before waking and during a long visit", () => {
  const { container } = render(
    <ol>{addDaylightDividers(items, date, location)}</ol>,
  );
  expect(
    [...container.querySelectorAll("li")].map((e) => e.textContent),
  ).toEqual([
    "06:48Sunrise",
    "Wake up",
    "Breakfast",
    "Museum · 180 min",
    "16:00Sunset",
    "Dinner",
  ]);
  expect(
    screen.getByRole("listitem", { name: "Sunrise" }).querySelector("time"),
  ).toHaveAttribute("datetime");
  expect(screen.getByRole("listitem", { name: "Sunset" })).not.toHaveAttribute(
    "data-order-index",
  );
  expect(container.querySelectorAll("[data-order-index]")).toHaveLength(1);
  expect(container.querySelectorAll("[data-order-meal]")).toHaveLength(2);
});

test("leaves the agenda intact when destination information is unavailable", () => {
  expect(addDaylightDividers(items, date)).toBe(items);
  expect(
    addDaylightDividers(items, date, { ...location, timeZone: null }),
  ).toBe(items);
});

test("shows a polar-day note without fake sunrise or sunset dividers", () => {
  render(
    <ol>
      {addDaylightDividers([], "2026-06-21", {
        latitude: 69.6492,
        longitude: 18.9553,
        timeZone: "Europe/Oslo",
      })}
    </ol>,
  );
  expect(screen.getByText("Midnight sun · No sunset")).toBeInTheDocument();
  expect(screen.queryByRole("time")).not.toBeInTheDocument();
});
