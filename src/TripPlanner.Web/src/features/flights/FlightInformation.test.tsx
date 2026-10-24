import { render, screen, within } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { expect, test } from "vitest";
import FlightInformation from "./FlightInformation";

test("highlights the departure airport's local weekday", () => {
  render(
    <FluentProvider theme={webLightTheme}>
      <FlightInformation
        leg={{
          segments: [
            {
              departure_airport: "ATL",
              arrival_airport: "HKT",
              departure_time_local: "2026-09-28T23:45:00",
              arrival_time_local: "2026-09-30T07:00:00",
            },
          ],
        }}
      />
    </FluentProvider>,
  );
  const weekdays = screen.getByLabelText("Flight leaves on Monday");
  expect(within(weekdays).getByText("M")).toHaveAttribute(
    "aria-current",
    "date",
  );
  expect(within(weekdays).getAllByText(/^(M|T|W|Th|F|Sa|Su)$/)).toHaveLength(7);
});

test("uses the route as the heading and shows the fare without redundant labels", () => {
  render(
    <FluentProvider theme={webLightTheme}>
      <FlightInformation
        price={{ amount: 825, currency: "USD" }}
        cities={{ ATL: "Atlanta", HKT: "Phuket" }}
        badge="This flight is on the cheapest route"
        leg={{
          segments: [
            {
              departure_airport: "ATL",
              arrival_airport: "HKT",
              departure_time_local: "2030-05-01T09:00:00",
              arrival_time_local: "2030-05-02T15:00:00",
            },
          ],
        }}
      />
    </FluentProvider>,
  );
  expect(
    screen
      .getByText("Atlanta (ATL) → Phuket (HKT)")
      .closest(".flight-information-heading"),
  ).toHaveTextContent("USD $825");
  expect(
    screen.getByText("This flight is on the cheapest route"),
  ).toBeVisible();
  expect(screen.queryByText("Times are local to each airport.")).toBeNull();
  expect(screen.queryByText("This flight")).toBeNull();
});

test("shows a separate preferred-airline badge when any segment matches", () => {
  render(
    <FluentProvider theme={webLightTheme}>
      <FlightInformation
        badge="This flight is on the cheapest route"
        preferredAirlines={["dl"]}
        leg={{
          carrier: "KLM",
          segments: [
            {
              departure_airport: "ATL",
              arrival_airport: "AMS",
              departure_time_local: "2030-05-01T09:00:00",
              arrival_time_local: "2030-05-01T20:00:00",
              marketing_carrier_code: "KL",
            },
            {
              departure_airport: "AMS",
              arrival_airport: "HKT",
              departure_time_local: "2030-05-01T22:00:00",
              arrival_time_local: "2030-05-02T16:00:00",
              marketing_carrier_code: "DL",
            },
          ],
        }}
      />
    </FluentProvider>,
  );
  expect(screen.getByText("Preferred Airline")).toBeVisible();
  expect(
    screen.getByText("This flight is on the cheapest route"),
  ).toBeVisible();
  expect(
    screen.getAllByText(
      /Preferred Airline|This flight is on the cheapest route/,
    ),
  ).toHaveLength(2);
});
