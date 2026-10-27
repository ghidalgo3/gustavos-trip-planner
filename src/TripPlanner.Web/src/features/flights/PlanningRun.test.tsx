import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import PlanningRun from "./PlanningRun";
import { legKey } from "./flightFormatting";
import type {
  PartySettings,
  PlanningConstraint,
  PlanningParty,
} from "./planningApi";
import {
  FlightSearchValidationError,
  getFlightSearchResults,
  getOperations,
  startFlightSearch,
  type TrackedOperation,
  type FareSearchResult,
} from "../../api/operationsApi";
import {
  getFlightChoices,
  getSelectedFlights,
  setFlightChoices,
} from "./selectedFlightsApi";

vi.mock("../../api/operationsApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/operationsApi")>()),
  getFlightSearchResults: vi.fn(),
  getOperations: vi.fn(),
  startFlightSearch: vi.fn(),
}));
vi.mock("./selectedFlightsApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./selectedFlightsApi")>()),
  getFlightChoices: vi.fn(),
  getSelectedFlights: vi.fn(),
  setFlightChoices: vi.fn(),
}));

const operation: TrackedOperation = {
  id: "operation",
  resourceId: "trip",
  type: "flightSearch",
  status: "pending",
  progress: { items: 2, completedItems: 0, failedItems: 0 },
  createdAt: "2030-01-01T12:00:00Z",
  updatedAt: "2030-01-01T12:00:00Z",
  pollingUrl: "/operations/operation",
};
const save = vi.fn(async () => undefined);

const party: PlanningParty = {
  id: "party",
  members: [{ id: "user", name: "Ada", homeCity: "Boston" }],
};
const partySettings: PartySettings = {
  partyId: "party",
  origin: null,
  cabin: "economy",
  market: "US",
  maxJourneyHours: 48,
  maxStops: null,
  preferredAirlines: [],
};

const reviewRequirements = vi.fn();

function show(
  parties: PlanningParty[] = [],
  settings: PartySettings[] = [],
  constraints: PlanningConstraint[] = [],
  currentAiPrompt?: string,
) {
  return render(planningRun(parties, settings, constraints, currentAiPrompt));
}

function planningRun(
  parties: PlanningParty[] = [],
  settings: PartySettings[] = [],
  constraints: PlanningConstraint[] = [],
  currentAiPrompt?: string,
  savedVersion = 0,
  hasUnsavedChanges = false,
) {
  return (
    <FluentProvider theme={webLightTheme}>
      <MemoryRouter>
        <PlanningRun
          tripId="trip"
          parties={parties}
          partySettings={settings}
          constraints={constraints}
          currentAiPrompt={currentAiPrompt}
          disabled={false}
          hasUnsavedChanges={hasUnsavedChanges}
          savedVersion={savedVersion}
          onBeforeSearch={save}
          onReviewRequirements={reviewRequirements}
        />
      </MemoryRouter>
    </FluentProvider>
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getOperations).mockResolvedValue([]);
  vi.mocked(getFlightSearchResults).mockResolvedValue([]);
  vi.mocked(getFlightChoices).mockResolvedValue([]);
  vi.mocked(getSelectedFlights).mockResolvedValue([]);
});
afterEach(() => vi.unstubAllGlobals());

test.each(["pending status", "failed results", "saved itinerary"])(
  "shows retained flights immediately without a search: %s",
  async (scenario) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({})),
    );
    const leg = {
      segments: [
        {
          departure_airport: "ATL",
          arrival_airport: "BOS",
          departure_time_local: "2030-05-01T10:00:00",
          arrival_time_local: "2030-05-01T12:00:00",
          marketing_carrier_code: "DL",
          flight_number: "123",
        },
      ],
    };
    if (scenario === "saved itinerary") {
      vi.mocked(getSelectedFlights).mockResolvedValue([
        {
          tripId: "trip",
          partyId: "party",
          cacheKey: "old-quote",
          itineraryIndex: 0,
          request: {
            origin: "ATL",
            destination: "BOS",
            departure_date: "2030-05-01",
            return_date: "2030-05-04",
            adults: 1,
            cabin_class: "economy",
            market: "US",
          },
          itinerary: {
            legs: [
              leg,
              {
                segments: [
                  {
                    ...leg.segments[0],
                    departure_airport: "BOS",
                    arrival_airport: "ATL",
                    departure_time_local: "2030-05-04T10:00:00",
                    arrival_time_local: "2030-05-04T12:00:00",
                    flight_number: "124",
                  },
                ],
              },
            ],
          },
          selectedAt: "2030-01-01T00:00:00Z",
        },
      ]);
    } else {
      vi.mocked(getFlightChoices).mockResolvedValue([
        {
          partyId: "party",
          legKeys: [legKey(leg), null],
          nextOrigins: ["BOS"],
          flights: [{ legIndex: 0, leg }],
        },
      ]);
    }
    if (scenario === "failed results") {
      vi.mocked(getFlightSearchResults).mockRejectedValue(
        new FlightSearchValidationError([
          {
            code: "invalidInput",
            message: "Update destination dates before searching.",
            partyId: null,
            constraintIds: [],
          },
        ]),
      );
    } else {
      vi.mocked(getOperations).mockImplementation(() => new Promise(() => {}));
    }
    render(
      <FluentProvider theme={webLightTheme}>
        <MemoryRouter>
          <PlanningRun
            tripId="trip"
            parties={[party]}
            partySettings={[partySettings]}
            constraints={[]}
            multiCity
            visits={[
              {
                id: "boston",
                location: {
                  code: "BOS",
                  label: "Boston",
                  timeZone: "America/New_York",
                },
                nights: 3,
                presentFrom: null,
                presentThrough: null,
                afterVisitIds: [],
              },
            ]}
            disabled={false}
            hasUnsavedChanges={false}
            savedVersion={0}
            onBeforeSearch={save}
            onReviewRequirements={reviewRequirements}
          />
        </MemoryRouter>
      </FluentProvider>,
    );
    const flight = await screen.findByRole("button", { name: /DL 123/ });
    expect(flight).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByText(
        `${scenario === "saved itinerary" ? 2 : 1} of 2 flights selected`,
      ),
    ).toBeVisible();
    expect(startFlightSearch).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "Review selected flights" }),
    ).toBeNull();
    if (scenario === "failed results") {
      expect(
        await screen.findByText("Update destination dates before searching."),
      ).toBeVisible();
      expect(flight).toBeVisible();
    }
  },
);

test("desktop partial choices save immediately, roll back failures, reload without a search, and require confirmation to clear", async () => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({})),
  );
  const outbound = {
    segments: [
      {
        departure_airport: "ATL",
        arrival_airport: "BOS",
        departure_time_local: "2030-05-01T10:00:00",
        arrival_time_local: "2030-05-01T12:00:00",
        marketing_carrier_code: "DL",
        flight_number: "1",
      },
    ],
  };
  const inbound = {
    segments: [
      {
        departure_airport: "BOS",
        arrival_airport: "ATL",
        departure_time_local: "2030-05-04T10:00:00",
        arrival_time_local: "2030-05-04T12:00:00",
        marketing_carrier_code: "DL",
        flight_number: "2",
      },
    ],
  };
  const result: FareSearchResult = {
    partyId: "party",
    cacheKey: "saved",
    fetchedAt: "2030-01-01T00:00:00Z",
    expiresAt: "2030-01-01T01:00:00Z",
    request: {
      origin: "ATL",
      destination: "BOS",
      departure_date: "2030-05-01",
      return_date: "2030-05-04",
      adults: 1,
      cabin_class: "economy",
      market: "US",
      searchKind: "itinerary",
    },
    response: {
      itineraries: [
        {
          legs: [outbound, inbound],
          price: { status: "verified", amount: 400, currency: "USD" },
        },
      ],
    },
    evaluations: [{ status: "Eligible", issues: [] }],
  };
  vi.mocked(getFlightSearchResults).mockResolvedValue([result]);
  let stored: (string | null)[] = [];
  vi.mocked(getFlightChoices).mockImplementation(async () => [
    { partyId: "party", legKeys: stored, nextOrigins: ["ATL"] },
  ]);
  vi.mocked(setFlightChoices)
    .mockRejectedValueOnce(new Error("Flight choice could not be saved"))
    .mockImplementation(async (_trip, partyId, legKeys) => {
      stored = legKeys;
      return { partyId, legKeys, nextOrigins: ["ATL"] };
    });
  const page = (
    <FluentProvider theme={webLightTheme}>
      <MemoryRouter>
        <PlanningRun
          tripId="trip"
          parties={[party]}
          partySettings={[partySettings]}
          constraints={[]}
          multiCity
          visitCount={1}
          visits={[
            {
              id: "boston",
              location: {
                code: "BOS",
                label: "Boston",
                timeZone: "America/New_York",
              },
              nights: 3,
              presentFrom: null,
              presentThrough: null,
              afterVisitIds: [],
            },
          ]}
          disabled={false}
          hasUnsavedChanges={false}
          savedVersion={0}
          onBeforeSearch={save}
          onReviewRequirements={reviewRequirements}
        />
      </MemoryRouter>
    </FluentProvider>
  );
  const view = render(page);
  fireEvent.click(
    await screen.findByRole("button", { name: /Choose flight DL 2/ }),
  );
  await screen.findAllByText("Flight choice could not be saved");
  expect(screen.getByText("0 of 2 flights selected")).toBeVisible();
  expect(screen.queryByRole("region", { name: "Selected flights" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Choose flight DL 2/ }));
  await waitFor(() => expect(stored).toEqual([null, legKey(inbound)]));
  expect(screen.getByText("1 of 2 flights selected")).toBeVisible();
  view.unmount();
  // Only the retained flight remains after cache expiry; no operation is needed.
  vi.mocked(getFlightSearchResults).mockResolvedValue([
    {
      ...result,
      response: {
        itineraries: [],
        flights: [{ legIndex: 1, leg: inbound, bookingLegCount: 1 }],
      },
      evaluations: [],
    },
  ]);
  render(page);
  expect(await screen.findByText("1 of 2 flights selected")).toBeVisible();
  const selected = await screen.findByRole("button", {
    name: /Choose flight DL 2/,
  });
  expect(selected).toHaveAttribute("aria-pressed", "true");
  expect(startFlightSearch).not.toHaveBeenCalled();
  fireEvent.click(selected);
  fireEvent.click(
    await screen.findByRole("button", { name: "Keep selections" }),
  );
  expect(setFlightChoices).toHaveBeenCalledTimes(2);
  fireEvent.click(
    await screen.findByRole("button", { name: /Choose flight DL 2/ }),
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Deselect flights" }),
  );
  await waitFor(() => expect(stored).toEqual([]));
  expect(await screen.findByText("0 of 2 flights selected")).toBeVisible();
  expect(setFlightChoices).toHaveBeenLastCalledWith(
    "trip",
    "party",
    [],
    undefined,
  );
});

test("a saved first flight advances to the second flight after search completes", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({})));
  vi.mocked(getOperations).mockResolvedValue([
    {
      ...operation,
      status: "Completed",
      progress: { items: 2, completedItems: 2, failedItems: 0 },
    },
  ]);
  let finishSave: (() => void) | undefined;
  vi.mocked(setFlightChoices).mockImplementation(
    (_, partyId, legKeys) =>
      new Promise((resolve) => {
        finishSave = () => resolve({ partyId, legKeys, nextOrigins: ["SAN"] });
      }),
  );
  const first = {
    segments: [
      {
        departure_airport: "ATL",
        arrival_airport: "SAN",
        departure_time_local: "2030-05-01T09:00:00",
        arrival_time_local: "2030-05-01T12:00:00",
        marketing_carrier_code: "DL",
        flight_number: "100",
      },
    ],
  };
  const second = {
    segments: [
      {
        departure_airport: "SAN",
        arrival_airport: "ATL",
        departure_time_local: "2030-05-05T09:00:00",
        arrival_time_local: "2030-05-05T15:00:00",
        marketing_carrier_code: "DL",
        flight_number: "200",
      },
    ],
  };
  vi.mocked(getFlightSearchResults).mockResolvedValue([
    {
      partyId: "party",
      cacheKey: "route",
      request: {
        origin: "ATL",
        destination: "SAN",
        departure_date: "2030-05-01",
        return_date: "2030-05-05",
        adults: 1,
        cabin_class: "economy",
        market: "US",
        searchKind: "itinerary",
      },
      response: {
        itineraries: [
          {
            legs: [first, second],
            price: { status: "verified", amount: 500, currency: "USD" },
          },
        ],
      },
      evaluations: [{ status: "Eligible", issues: [] }],
      fetchedAt: "2030-01-01T00:00:00Z",
      expiresAt: "2030-01-01T01:00:00Z",
    },
  ]);
  render(
    <FluentProvider theme={webLightTheme}>
      <MemoryRouter>
        <PlanningRun
          tripId="trip"
          parties={[party]}
          partySettings={[partySettings]}
          constraints={[]}
          multiCity
          visitCount={1}
          disabled={false}
          hasUnsavedChanges={false}
          savedVersion={0}
          onBeforeSearch={save}
          onReviewRequirements={reviewRequirements}
        />
      </MemoryRouter>
    </FluentProvider>,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Choose flight 1" }),
  );
  await waitFor(() => expect(setFlightChoices).toHaveBeenCalledOnce());
  await waitFor(() =>
    expect(screen.getByRole("tab", { name: /Flight 2/ })).toHaveAttribute(
      "aria-selected",
      "true",
    ),
  );
  expect(screen.getByText("Saving flight choice…")).toBeVisible();
  finishSave?.();
  await waitFor(() =>
    expect(screen.queryByText("Saving flight choice…")).not.toBeInTheDocument(),
  );
});

test("a saved first flight advances while later route searches continue", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({})));
  vi.mocked(getOperations).mockResolvedValue([
    {
      ...operation,
      status: "InProgress",
      progress: { items: 3, completedItems: 2, failedItems: 0 },
    },
  ]);
  vi.mocked(setFlightChoices).mockImplementation(
    async (_, partyId, legKeys) => ({
      partyId,
      legKeys,
      nextOrigins: ["SAN"],
    }),
  );
  const fares = [
    { origin: "ATL", destination: "SAN", priority: 0, flight: "100" },
    { origin: "SAN", destination: "SFO", priority: 1, flight: "200" },
  ].map(({ origin, destination, priority, flight }) => ({
    partyId: "party",
    cacheKey: flight,
    request: {
      origin,
      destination,
      departure_date: "2030-05-01",
      return_date: "2030-05-01",
      adults: 1,
      cabin_class: "economy",
      market: "US",
      searchKind: "oneWay" as const,
      searchPriority: priority,
    },
    response: {
      itineraries: [
        {
          price: { status: "verified", amount: 200, currency: "USD" },
          outbound: {
            segments: [
              {
                departure_airport: origin,
                arrival_airport: destination,
                departure_time_local: "2030-05-01T09:00:00",
                arrival_time_local: "2030-05-01T12:00:00",
                marketing_carrier_code: "DL",
                flight_number: flight,
              },
            ],
          },
        },
      ],
    },
    evaluations: [{ status: "Unverifiable" as const, issues: [] }],
    fetchedAt: "2030-01-01T00:00:00Z",
    expiresAt: "2030-01-01T01:00:00Z",
  }));
  vi.mocked(getFlightSearchResults).mockResolvedValue(fares);
  render(
    <FluentProvider theme={webLightTheme}>
      <MemoryRouter>
        <PlanningRun
          tripId="trip"
          parties={[party]}
          partySettings={[partySettings]}
          constraints={[]}
          multiCity
          visitCount={2}
          disabled={false}
          hasUnsavedChanges={false}
          savedVersion={0}
          onBeforeSearch={save}
          onReviewRequirements={reviewRequirements}
        />
      </MemoryRouter>
    </FluentProvider>,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Choose flight 1" }),
  );
  await waitFor(() => expect(setFlightChoices).toHaveBeenCalledOnce());
  expect(await screen.findByRole("tab", { name: /Flight 2/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(screen.getByRole("button", { name: "Choose flight 2" })).toBeVisible();
});

test("saves constraints, starts asynchronously, and retrieves the fare cache", async () => {
  show();
  await waitFor(() => expect(getOperations).toHaveBeenCalled());
  vi.mocked(startFlightSearch).mockResolvedValue(operation);
  vi.mocked(getOperations).mockResolvedValue([operation]);
  fireEvent.click(screen.getByRole("button", { name: "Find flights" }));
  expect(await screen.findByRole("status")).toHaveTextContent(
    "0 of 2 searches completed",
  );
  expect(save).toHaveBeenCalledOnce();
  expect(startFlightSearch).toHaveBeenCalledWith("trip", expect.any(String));
  expect(
    screen.getByRole("button", { name: "Searching flights…" }),
  ).toBeDisabled();
  vi.mocked(getOperations).mockResolvedValue([
    {
      ...operation,
      status: "Completed",
      progress: { items: 2, completedItems: 2, failedItems: 0 },
    },
  ]);
  await waitFor(
    () =>
      expect(screen.getByRole("status")).toHaveTextContent("Search complete"),
    { timeout: 4500 },
  );
  expect(getFlightSearchResults).toHaveBeenCalledWith(
    "trip",
    expect.any(AbortSignal),
  );
  expect(screen.getByRole("button", { name: "Find flights" })).toBeEnabled();
});

test("reopening a trip discovers its latest operation from the generic list", async () => {
  vi.mocked(getOperations).mockResolvedValue([
    {
      ...operation,
      status: "Completed",
      progress: { items: 1, completedItems: 1, failedItems: 0 },
    },
    { ...operation, id: "another", resourceId: "another-trip" },
  ]);
  vi.mocked(getFlightSearchResults).mockResolvedValue([
    {
      partyId: "party",
      cacheKey: "hash",
      request: {
        origin: "BOS",
        destination: "CDG",
        departure_date: "2030-01-05",
        return_date: "2030-01-15",
        adults: 1,
        cabin_class: "economy",
        market: "US",
      },
      response: { itineraries: [] },
      evaluations: [],
      fetchedAt: "2030-01-01T12:00:00Z",
      expiresAt: "2030-01-01T13:00:00Z",
    },
  ]);
  const view = show([party], [partySettings]);
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Search complete",
  );
  expect(
    await screen.findByRole("heading", { name: "Flight options" }),
  ).toBeVisible();
  expect(startFlightSearch).not.toHaveBeenCalled();
  expect(getOperations).toHaveBeenCalledWith(expect.any(AbortSignal), {
    type: "flightSearch",
  });
  const signal = vi.mocked(getOperations).mock.calls[0][0];
  view.unmount();
  expect(signal.aborted).toBe(true);
});

test("hides results during edits and reloads their evaluation after saving", async () => {
  vi.mocked(getOperations).mockResolvedValue([
    { ...operation, status: "Completed" },
  ]);
  vi.mocked(getFlightSearchResults).mockResolvedValue([
    {
      partyId: "party",
      cacheKey: "hash",
      request: {
        origin: "BOS",
        destination: "CDG",
        departure_date: "2030-01-05",
        return_date: "2030-01-15",
        adults: 1,
        cabin_class: "economy",
        market: "US",
      },
      response: { itineraries: [] },
      evaluations: [],
      fetchedAt: "2030-01-01T12:00:00Z",
      expiresAt: "2030-01-01T13:00:00Z",
    },
  ]);
  const view = show([party], [partySettings]);
  expect(
    await screen.findByRole("heading", { name: "Flight options" }),
  ).toBeVisible();
  view.rerender(planningRun([party], [partySettings], [], undefined, 0, true));
  expect(
    screen.queryByRole("heading", { name: "Flight options" }),
  ).not.toBeInTheDocument();
  expect(screen.getByText(/Save planning details to refresh/)).toBeVisible();
  view.rerender(planningRun([party], [partySettings], [], undefined, 1));
  await waitFor(() => expect(getFlightSearchResults).toHaveBeenCalledTimes(2));
  expect(
    await screen.findByRole("heading", { name: "Flight options" }),
  ).toBeVisible();
});

test("retries uncertain submissions with the same request ID", async () => {
  vi.mocked(startFlightSearch).mockRejectedValue(
    new Error("Network unavailable"),
  );
  show();
  fireEvent.click(screen.getByRole("button", { name: "Find flights" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Network unavailable",
  );
  fireEvent.click(screen.getByRole("button", { name: "Find flights" }));
  await waitFor(() => expect(startFlightSearch).toHaveBeenCalledTimes(2));
  expect(vi.mocked(startFlightSearch).mock.calls[1][1]).toBe(
    vi.mocked(startFlightSearch).mock.calls[0][1],
  );
});

test("explains date conflicts with affected requirement values", async () => {
  const returnWindow: PlanningConstraint = {
    id: "old-return",
    userId: "user",
    type: "returnHomeWindow",
    window: { earliest: "2030-12-03", latest: "2030-12-09", preferred: null },
    originalInput: "Old New York trip",
    countryCodes: [],
  };
  const stay: PlanningConstraint = {
    id: "new-stay",
    userId: "user",
    type: "presence",
    startDate: "2031-01-06",
    endDate: "2031-01-08",
    countryCodes: [],
  };
  vi.mocked(startFlightSearch).mockRejectedValue(
    new FlightSearchValidationError([
      {
        code: "conflict",
        partyId: "party",
        constraintIds: ["old-return", "new-stay"],
        message:
          "Return-flight window ends Dec 9, 2030, before the required stay ends Jan 8, 2031.",
      },
    ]),
  );
  show([party], [partySettings], [returnWindow, stay], "New Boise trip");
  fireEvent.click(screen.getByRole("button", { name: "Find flights" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Travel dates need attention",
  );
  expect(screen.getByLabelText("Planning conflicts")).toHaveTextContent(
    "Dec 9, 2030",
  );
  expect(screen.getByLabelText("Planning conflicts")).toHaveTextContent(
    "Requirement 1: Return flight",
  );
  expect(screen.getByLabelText("Planning conflicts")).toHaveTextContent(
    "from an earlier trip description",
  );
  expect(screen.getByLabelText("Planning conflicts")).toHaveTextContent(
    "Requirement 2: Required destination stay",
  );
  fireEvent.click(screen.getByRole("button", { name: "Review trip details" }));
  expect(reviewRequirements).toHaveBeenCalledWith("old-return");
});

test("expired destination dates hide an unrelated historical search status and offer Overview", async () => {
  vi.mocked(getOperations).mockResolvedValue([
    {
      ...operation,
      status: "Failed",
      progress: { items: 133, completedItems: 131, failedItems: 2 },
    },
  ]);
  const message =
    "The latest allowed arrival in Tokyo is 2026-10-06, which is in the past. Update this destination's dates on Overview.";
  vi.mocked(getFlightSearchResults).mockRejectedValue(
    new FlightSearchValidationError([
      {
        code: "invalidInput",
        message,
        partyId: null,
        constraintIds: ["tokyo-stay"],
      },
    ]),
  );
  show();
  expect(await screen.findByText(message)).toBeVisible();
  expect(screen.queryByText(/131 of 133/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Checking again shortly/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Review trip details" }));
  expect(reviewRequirements).toHaveBeenCalledWith("tokyo-stay");
});

test.each([true, false])(
  "progressive results use the destination grid on desktop and phone screens (wide: %s)",
  async (wide) => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: query === "(min-width: 1100px)" && wide,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({})),
    );
    vi.mocked(getOperations).mockResolvedValue([
      {
        ...operation,
        status: "InProgress",
        progress: { items: 4, completedItems: 1, failedItems: 0 },
      },
    ]);
    vi.mocked(getFlightSearchResults).mockResolvedValue([
      {
        partyId: "party",
        cacheKey: "partial",
        fetchedAt: "2030-01-01T00:00:00Z",
        expiresAt: "2030-01-01T01:00:00Z",
        request: {
          origin: "ATL",
          destination: "BOS",
          departure_date: "2030-05-01",
          return_date: "2030-05-04",
          adults: 1,
          cabin_class: "economy",
          market: "US",
          searchKind: "itinerary",
        },
        response: {
          itineraries: [],
          flights: [
            {
              legIndex: 0,
              bookingLegCount: 1,
              leg: {
                segments: [
                  {
                    departure_airport: "ATL",
                    arrival_airport: "BOS",
                    departure_time_local: "2030-05-01T10:00:00",
                    arrival_time_local: "2030-05-01T12:00:00",
                  },
                ],
              },
            },
          ],
        },
        evaluations: [],
      },
    ]);
    const page = (readOnly = false) => (
      <FluentProvider theme={webLightTheme}>
        <MemoryRouter>
          <PlanningRun
            tripId="trip"
            parties={[party]}
            partySettings={[partySettings]}
            constraints={[]}
            multiCity
            readOnly={readOnly}
            visitCount={1}
            visits={[
              {
                id: "boston",
                location: {
                  code: "BOS",
                  label: "Boston",
                  timeZone: "America/New_York",
                },
                nights: 3,
                presentFrom: null,
                presentThrough: null,
                afterVisitIds: [],
              },
            ]}
            disabled={false}
            hasUnsavedChanges={false}
            savedVersion={0}
            onBeforeSearch={save}
            onReviewRequirements={reviewRequirements}
          />
        </MemoryRouter>
      </FluentProvider>
    );
    const view = render(page());
    await screen.findByText("Prices last retrieved", { exact: false });
    expect(
      screen.getByRole("region", {
        name: "Flight destinations and connections",
      }),
    ).toBeVisible();
    expect(screen.getByRole("heading", { name: "Boston" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Return home" })).toBeVisible();
    expect(screen.queryByRole("tab", { name: /Flight 1/ })).toBeNull();
    expect(
      screen
        .getByRole("slider", { name: "Maximum total trip cost" })
        .closest(".fui-Slider"),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: /^Choose flight/ }),
    ).toBeVisible();
    expect(
      screen.getByLabelText("Loading flights for return home"),
    ).toBeVisible();
    const flight = screen.getByRole("button", { name: /^Choose flight/ });
    const polls = vi.mocked(getOperations).mock.calls.length;
    const searches = vi.mocked(getFlightSearchResults).mock.calls.length;
    view.rerender(page(true));
    expect(screen.getByRole("button", { name: /^Choose flight/ })).toBe(flight);
    expect(flight).toBeDisabled();
    expect(screen.getByRole("button", { name: "Find flights" })).toBeDisabled();
    expect(
      screen.queryByLabelText("Loading flights for return home"),
    ).toBeNull();
    expect(getOperations).toHaveBeenCalledTimes(polls);
    expect(getFlightSearchResults).toHaveBeenCalledTimes(searches);
  },
);
