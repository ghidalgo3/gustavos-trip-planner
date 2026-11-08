import { tripDocumentFixture } from "../../test/tripDocumentFixture";
import {
  clearTripDocumentCache,
  openTripDocument,
  refreshTripDocument,
  tripFetch,
} from "../../api/tripDocumentStore";
import { memoryStorage } from "../../test/memoryStorage";
import { legKey } from "./flightFormatting";
import type { FareLeg } from "../../api/operationsApi";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { MemoryRouter } from "react-router";
import { afterEach, expect, test, vi } from "vitest";
import TripPlanning from "./TripPlanning";
import type { Trip } from "../../api/api";

afterEach(() => {
  clearTripDocumentCache();
  vi.unstubAllGlobals();
});

const savedLeg: FareLeg = {
  duration_minutes: 780,
  segments: [
    {
      departure_airport: "BOS",
      arrival_airport: "NRT",
      departure_time_local: "2030-04-01T18:00:00",
      arrival_time_local: "2030-04-02T20:00:00",
      marketing_carrier_code: "JL",
      flight_number: "8",
    },
  ],
};
async function offlineFlights(choices: unknown[], bookings: unknown[] = []) {
  const trip: Trip = {
    id: "trip",
    ownerUserId: "owner",
    name: "Japan",
    description: "",
    constraints: {},
    createdAt: "",
    updatedAt: "",
  };
  const prefix = "/trips/trip";
  const groups = [{ id: "party", personIds: ["owner"] }];
  const progress = choices as {
    partyId: string;
    flights?: { legIndex: number; leg: Record<string, unknown> }[];
    unmatchedFlights?: Record<string, unknown>[];
    [key: string]: unknown;
  }[];
  const document = tripDocumentFixture(trip, {
    places: [
      {
        id: "bos",
        name: "Logan",
        type: "Airport",
        iataCode: "BOS",
        address: { addressLocality: "Boston" },
      },
      {
        id: "nrt",
        name: "Narita",
        type: "Airport",
        iataCode: "NRT",
        address: { addressLocality: "Tokyo" },
      },
      {
        id: "tokyo",
        name: "Tokyo",
        type: "Place",
        destinationId: "tokyo",
        countryCode: "JP",
        timeZone: "Asia/Tokyo",
        location: null,
        active: true,
      },
    ],
    itinerary: {
      visits: [
        {
          id: "visit",
          order: 0,
          destinationId: "tokyo",
          arrivalDate: "2030-04-02",
          departureDate: "2030-04-10",
          accommodationPlaceId: null,
        },
      ],
      days: [],
      schedule: [],
    },
    preferences: {
      constraints: {},
      groups,
      activities: {},
      destinations: [
        {
          destinationId: "tokyo",
          constraints: {},
          activities: {},
          schedule: {},
        },
      ],
      flightChoices: progress.map((c) =>
        Object.fromEntries([
          ...Object.entries(c).filter(
            ([key]) =>
              !["partyId", "flights", "unmatchedFlights"].includes(key),
          ),
          ["groupId", c.partyId],
        ]),
      ),
    },
    transportation: {
      legs: [],
      journeys: progress.flatMap((c) => [
        ...(c.flights ?? []).map((f) => ({
          groupId: c.partyId,
          legIndex: f.legIndex,
          details: f.leg,
        })),
        ...(c.unmatchedFlights ?? []).map((f) => ({
          groupId: c.partyId,
          legIndex: null,
          details: f,
        })),
      ]),
      bookings: bookings as Record<string, unknown>[],
    },
  });
  const planning = {
    parties: [{ partyId: "party", preferredAirlines: ["JL"] }],
    visits: [
      {
        id: "visit",
        location: { code: "TYO", label: "Tokyo", timeZone: "Asia/Tokyo" },
        nights: 8,
        presentFrom: "2030-04-02",
        presentThrough: "2030-04-10",
        afterVisitIds: [],
      },
    ],
    constraints: [],
  };
  vi.stubGlobal("localStorage", memoryStorage());
  const network = vi
    .fn()
    .mockResolvedValueOnce(Response.json(document))
    .mockResolvedValueOnce(Response.json(planning))
    .mockRejectedValue(new TypeError("Offline"));
  vi.stubGlobal("fetch", network);
  await openTripDocument("owner", "trip", "");
  await tripFetch(prefix + "/flights/constraints");
  await refreshTripDocument();
  render(
    <FluentProvider theme={webLightTheme}>
      <MemoryRouter>
        <TripPlanning trip={trip} onBack={vi.fn()} readOnly />
      </MemoryRouter>
    </FluentProvider>,
  );
  return network;
}

const key = legKey(savedLeg);
const choice = {
  partyId: "party",
  legKeys: [key, null],
  nextOrigins: [],
  flights: [{ legIndex: 0, leg: savedLeg }],
  purchasedOfferIds: ["booked"],
  bookings: [
    {
      ignavId: "booked",
      legIndexes: [0],
      legKeys: [key],
      price: { amount: 700, currency: "USD", status: "verified" },
    },
  ],
};

test("offline grid preserves partial selections, booking status and details without network reads or edits", async () => {
  const network = await offlineFlights([choice]);
  const flight = await screen.findByRole("button", {
    name: /Choose flight JL 8/,
  });
  expect(
    screen.getByRole("region", { name: "Flight destinations and connections" }),
  ).toBeVisible();
  expect(screen.getByRole("heading", { name: "Tokyo" })).toBeVisible();
  expect(flight).toHaveAttribute("aria-pressed", "true");
  expect(flight).toBeDisabled();
  expect(screen.getByRole("switch", { name: "Booked" })).toBeChecked();
  expect(screen.getByRole("switch", { name: "Booked" })).toBeDisabled();
  for (const name of ["Find flights", "Clear selections", "Booking Link"]) {
    expect(screen.getByRole("button", { name })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name }));
  }
  fireEvent.click(flight.closest(".flight-grid-card")!);
  expect(screen.getByRole("combobox", { name: "Allowed stops" })).toBeEnabled();
  expect(
    screen.getByRole("combobox", { name: "Allowed airlines" }),
  ).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Price: ascending" }));
  expect(
    screen.getByRole("button", { name: "Price: descending" }),
  ).toBeEnabled();
  fireEvent.click(screen.getByRole("combobox", { name: "Allowed stops" }));
  fireEvent.click(
    await screen.findByRole("menuitemcheckbox", { name: "Nonstop" }),
  );
  expect(
    screen.getByRole("combobox", { name: "Allowed stops" }),
  ).toHaveTextContent("1 stop, 2+ stops");
  fireEvent.keyDown(screen.getByRole("combobox", { name: "Allowed stops" }), {
    key: "Escape",
  });
  // Selected flights remain visible when local filters change.
  expect(flight).toBeVisible();
  fireEvent.click(screen.getByText("Flight details", { exact: true }));
  await waitFor(() =>
    expect(document.querySelector("details")).toHaveAttribute("open"),
  );
  expect(flight).toHaveAttribute("aria-pressed", "true");
  expect(network).toHaveBeenCalledTimes(3);
});

test.each(["legs", "outbound/inbound"])(
  "offline grid restores saved %s selections and purchases",
  async (shape) => {
    const home = {
      ...savedLeg,
      segments: [
        {
          ...savedLeg.segments[0],
          departure_airport: "NRT",
          arrival_airport: "BOS",
          flight_number: "7",
        },
      ],
    };
    const itinerary =
      shape === "legs"
        ? { legs: [savedLeg, home] }
        : { outbound: savedLeg, inbound: home };
    const network = await offlineFlights(
      [],
      [
        {
          partyId: "party",
          itinerary,
          request: { adults: 1 },
          purchasedLegs: [true, false],
        },
      ],
    );
    expect(await screen.findByText("2 of 2 flights selected")).toBeVisible();
    const flights = screen.getAllByRole("button", { name: /Choose flight JL/ });
    expect(flights).toHaveLength(2);
    for (const flight of flights) {
      expect(flight).toBeDisabled();
      expect(flight).toHaveAttribute("aria-pressed", "true");
    }
    const booked = screen.getAllByRole("switch", { name: "Booked" });
    expect(booked[0]).toBeChecked();
    expect(booked[1]).not.toBeChecked();
    expect(network).toHaveBeenCalledTimes(3);
  },
);

test("offline grid retains displaced saved flights for review without enabling clear", async () => {
  const network = await offlineFlights([
    {
      partyId: "party",
      legKeys: [],
      nextOrigins: [],
      flights: [],
      unmatchedFlights: [savedLeg],
    },
  ]);
  expect(
    await screen.findByText("Review saved flights after changing stops"),
  ).toBeVisible();
  expect(screen.getByText(/JL 8 · BOS → NRT/)).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Clear selections" }),
  ).toBeDisabled();
  expect(network).toHaveBeenCalledTimes(3);
});

test("offline grid honors an explicit cleared choice over an old itinerary", async () => {
  await offlineFlights(
    [{ partyId: "party", legKeys: [], nextOrigins: [], flights: [] }],
    [{ partyId: "party", itinerary: { legs: [savedLeg, savedLeg] } }],
  );
  expect(await screen.findByText("0 of 2 flights selected")).toBeVisible();
  expect(
    screen.queryByRole("button", { name: /Choose flight JL 8/ }),
  ).toBeNull();
});
