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
  ["overview", "Overview"],
  ["flights", "Flights"],
  ["activities", "Activities"],
  ["party", "Party"],
] as const)(
  "breadcrumbs identify %s and navigate to parents",
  (section, current) => {
    render(
      <ColorSchemeProvider>
        <MemoryRouter initialEntries={["/trips/trip/activities"]}>
          <TripBreadcrumbs trip={trip} section={section} />
          <Location />
        </MemoryRouter>
      </ColorSchemeProvider>,
    );
    const breadcrumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(breadcrumb).getByText(current)).toHaveAttribute(
      "aria-current",
      "page",
    );
    if (section !== "overview") {
      expect(
        within(breadcrumb).getByRole("link", { name: "Overview" }),
      ).toHaveAttribute("href", "/trips/trip");
      fireEvent.click(
        within(breadcrumb).getByRole("link", { name: "Overview" }),
      );
      expect(screen.getByTestId("route")).toHaveTextContent("/trips/trip");
    }
    fireEvent.click(within(breadcrumb).getByRole("link", { name: "Trips" }));
    expect(screen.getByTestId("route").textContent).toBe("/");
  },
);
