import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { addFlightItems } from "./AgendaFlights";
import type { Availability } from "./activityPlanApi";

const date = "2027-06-10";
const availability: Availability = {
  stayId: "visit",
  date,
  availableFrom: "12:00:00",
  availableUntil: "17:00:00",
  ambiguous: false,
  explanation: "",
  flightChoices: [],
  availableFromInstant: `${date}T12:00:00+02:00`,
  availableUntilInstant: `${date}T17:00:00+02:00`,
  candidates: [
    {
      id: "arrival",
      travellerId: "traveller",
      travellerName: "Gustavo",
      direction: "arrival",
      time: `${date}T10:00:00+02:00`,
      selected: true,
      departureAirport: "BOS",
      arrivalAirport: "CDG",
      departure: `${date}T00:00:00+02:00`,
      arrival: `${date}T10:00:00+02:00`,
    },
    {
      id: "departure",
      travellerId: "traveller",
      travellerName: "Gustavo",
      direction: "departure",
      time: `${date}T20:00:00+02:00`,
      selected: true,
      departureAirport: "CDG",
      arrivalAirport: "BOS",
      departure: `${date}T20:00:00+02:00`,
      arrival: "2027-06-11T02:00:00+02:00",
    },
  ],
};

test("shows flight endpoints, cross-date arrival, and buffered unavailable periods", () => {
  const { container } = render(
    <ol>
      {addFlightItems(
        [
          <li key="wake" data-agenda-time={`${date}T07:00`}>
            Wake up
          </li>,
          <li
            key="activity"
            data-order-index={0}
            data-agenda-time={`${date}T14:00`}
          >
            Museum
          </li>,
        ],
        date,
        availability,
      )}
    </ol>,
  );
  expect(screen.getByText("Flight · BOS → CDG")).toBeVisible();
  expect(screen.getByText(/Arrives 2027-06-11 02:00/)).toBeVisible();
  expect(screen.getByText("Unavailable until 12:00")).toBeVisible();
  expect(screen.getByText("Unavailable from 17:00")).toBeVisible();
  expect(screen.getByText("Wake up")).toHaveAttribute("data-order-unavailable");
  expect(screen.getByText("Museum")).not.toHaveAttribute(
    "data-order-unavailable",
  );
  expect(container.querySelectorAll("[data-order-index]")).toHaveLength(1);
  expect(container.querySelectorAll("ol > div")).toHaveLength(0);
});

test("ambiguous flight candidates do not invent selected flight cards or blocked periods", () => {
  render(
    <ol>
      {addFlightItems([], date, {
        ...availability,
        ambiguous: true,
        availableFromInstant: null,
        availableUntilInstant: null,
        candidates: availability.candidates!.map((c) => ({
          ...c,
          selected: false,
        })),
      })}
    </ol>,
  );
  expect(screen.queryByText(/Flight ·/)).toBeNull();
  expect(screen.queryByText(/Unavailable/)).toBeNull();
});

test("the arrival cutoff appears before an activity starting exactly when it becomes available", () => {
  const { container } = render(
    <ol>
      {addFlightItems(
        [
          <li
            key="activity"
            data-order-index={0}
            data-agenda-time={`${date}T12:00`}
          >
            Museum
          </li>,
        ],
        date,
        availability,
      )}
    </ol>,
  );
  const rows = [...container.querySelectorAll("ol > li")];
  expect(
    rows.findIndex((row) => row.textContent?.includes("Unavailable until")),
  ).toBeLessThan(rows.findIndex((row) => row.textContent === "Museum"));
  expect(screen.getByText("Museum")).not.toHaveAttribute(
    "data-order-unavailable",
  );
});
