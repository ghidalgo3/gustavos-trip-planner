import { render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import TripDateSummary from "./TripDateSummary";
import type { Trip } from "../../api/api";
import type { Destination } from "../activities/activitiesApi";

test("dates include each destination country once and update with the itinerary", () => {
  const trip = { startDate: "2026-12-25", endDate: "2027-01-12" } as Trip;
  const destinations = ["JP", "KR", "jp", "ZZ"].map((countryCode) => ({
    properties: { countryCode },
  })) as Destination[];
  const { rerender } = render(
    <TripDateSummary trip={trip} destinations={destinations} />,
  );
  expect(screen.getByText("Dec 25, 2026 – Jan 12, 2027")).toBeVisible();
  expect(
    within(screen.getByLabelText("Trip countries")).getAllByRole("img"),
  ).toHaveLength(2);
  expect(
    screen.getByRole("img", { name: "Japan" }).querySelector("use"),
  ).toHaveAttribute("href", "/artwork/flags.svg#jp");
  rerender(<TripDateSummary trip={trip} destinations={[]} />);
  expect(screen.queryByLabelText("Trip countries")).not.toBeInTheDocument();
});

test("undated trips retain a useful date placeholder", () => {
  render(<TripDateSummary trip={{} as Trip} destinations={[]} />);
  expect(screen.getByText("Dates to decide")).toBeVisible();
});
