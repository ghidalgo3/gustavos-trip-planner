import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { afterEach, expect, test, vi } from "vitest";
import PlansOverview from "./PlansOverview";
import type { Trip } from "./api";

afterEach(() => vi.unstubAllGlobals());

test("shows a saved flight after fare search and can clear it", async () => {
  const trip: Trip = {
    id: "trip",
    ownerUserId: "user",
    name: "Paris",
    description: "Spring break",
    constraints: {},
    createdAt: "2030-01-01T00:00:00Z",
    updatedAt: "2030-01-01T00:00:00Z",
  };
  let selected = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/planning"))
        return Response.json({
          parties: [{ id: "party", members: [{ id: "user", name: "Ada" }] }],
        });
      if (init?.method === "DELETE") {
        selected = false;
        return new Response(null, { status: 204 });
      }
      return Response.json(
        selected
          ? [
              {
                tripId: "trip",
                partyId: "party",
                cacheKey: "fare",
                itineraryIndex: 0,
                request: {
                  origin: "BOS",
                  destination: "CDG",
                  departure_date: "2030-04-01",
                  return_date: "2030-04-10",
                },
                itinerary: {
                  price: { amount: 400, currency: "USD" },
                  outbound: { segments: [{ flight_number: "123" }] },
                  inbound: { segments: [{ flight_number: "456" }] },
                },
                selectedAt: "2030-01-01T12:00:00Z",
              },
            ]
          : [],
      );
    }),
  );
  render(
    <FluentProvider theme={webLightTheme}>
      <PlansOverview trip={trip} userId="user" onFindFlights={vi.fn()} />
    </FluentProvider>,
  );
  expect(await screen.findByText("BOS → CDG → BOS")).toBeVisible();
  expect(screen.getByText("Flight numbers: 123, 456")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Deselect flight" }));
  await waitFor(() =>
    expect(screen.getByText("No flight selected yet")).toBeVisible(),
  );
});

test("shared traveler can see the plan without edit controls", async () => {
  const trip: Trip = {
    id: "trip",
    ownerUserId: "owner",
    name: "Paris",
    description: "Spring break",
    constraints: {},
    createdAt: "2030-01-01T00:00:00Z",
    updatedAt: "2030-01-01T00:00:00Z",
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) =>
      Response.json(
        String(input).endsWith("/planning")
          ? {
              parties: [
                {
                  id: "party",
                  members: [
                    { id: "owner", name: "Ada" },
                    { id: "member", name: "Ben" },
                  ],
                },
              ],
            }
          : [],
      ),
    ),
  );
  render(
    <FluentProvider theme={webLightTheme}>
      <PlansOverview
        trip={trip}
        userId="member"
        onFindFlights={vi.fn()}
        readOnly
      />
    </FluentProvider>,
  );
  expect(await screen.findByText("Ada, Ben")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Find flights" })).toBeNull();
  expect(screen.queryByRole("combobox", { name: "Add traveler" })).toBeNull();
});
