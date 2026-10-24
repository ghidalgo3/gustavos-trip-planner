import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { expect, test } from "vitest";
import ColorSchemeProvider from "../../app/ColorSchemeProvider";
import TripBreadcrumbs from "./TripBreadcrumbs";
import type { Trip } from "../../api/api";

const trip: Trip = {
  id: "trip",
  ownerUserId: "owner",
  name: "Europe",
  description: "",
  constraints: {},
  createdAt: "",
  updatedAt: "",
};
function Location() {
  return <output data-testid="route">{useLocation().pathname}</output>;
}

test.each([
  ["overview", undefined, "Overview"],
  ["flights", undefined, "Flights"],
  ["activities", undefined, "Activities"],
  ["activities", "Paris", "Paris"],
] as const)(
  "breadcrumbs identify %s with destination %s and navigate to parents",
  (section, destinationName, current) => {
    render(
      <ColorSchemeProvider>
        <MemoryRouter initialEntries={["/trips/trip/activities"]}>
          <TripBreadcrumbs
            trip={trip}
            section={section}
            destinationName={destinationName}
          />
          <Location />
        </MemoryRouter>
      </ColorSchemeProvider>,
    );
    const breadcrumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(breadcrumb).getByText(current)).toHaveAttribute(
      "aria-current",
      "page",
    );
    if (destinationName)
      expect(
        within(breadcrumb).getByRole("link", { name: "Activities" }),
      ).toHaveAttribute("href", "/trips/trip/activities");
    fireEvent.click(within(breadcrumb).getByRole("link", { name: "Europe" }));
    expect(screen.getByTestId("route")).toHaveTextContent("/trips/trip");
    fireEvent.click(within(breadcrumb).getByRole("link", { name: "Trips" }));
    expect(screen.getByTestId("route").textContent).toBe("/");
  },
);
