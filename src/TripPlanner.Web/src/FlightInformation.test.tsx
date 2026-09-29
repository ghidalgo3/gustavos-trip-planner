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

test("shows the available fare in the upper-right header", () => {
  render(
    <FluentProvider theme={webLightTheme}>
      <FlightInformation
        title="Flight 1"
        price={{ amount: 825, currency: "USD" }}
        priceContext="This flight"
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
    screen.getByText("Flight 1").closest(".flight-information-heading"),
  ).toHaveTextContent("USD $825");
  expect(screen.getByText("This flight")).toBeVisible();
});
