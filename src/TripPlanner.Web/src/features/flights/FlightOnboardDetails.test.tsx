import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import FlightOnboardDetails from "./FlightOnboardDetails";

test("connecting flights identify aircraft per segment without inventing missing onboard information", () => {
  render(
    <FlightOnboardDetails
      leg={{
        segments: [
          {
            departure_airport: "ATL",
            arrival_airport: "JFK",
            departure_time_local: "2030-05-01T10:00:00",
            arrival_time_local: "2030-05-01T12:00:00",
            aircraft: "Airbus A320",
          },
          {
            departure_airport: "JFK",
            arrival_airport: "BOS",
            departure_time_local: "2030-05-01T14:00:00",
            arrival_time_local: "2030-05-01T15:00:00",
            aircraft: null,
          },
        ],
      }}
    />,
  );
  expect(screen.getByText("ATL → JFK")).toBeVisible();
  expect(screen.getByText("JFK → BOS")).toBeVisible();
  expect(screen.getByText("Aircraft: Airbus A320")).toBeVisible();
  expect(screen.getByText("Aircraft: Not provided")).toBeVisible();
  expect(screen.queryByText("Amenities not provided")).toBeNull();
  expect(screen.queryByText(/Wi-Fi|USB|2030-05/)).toBeNull();
});
