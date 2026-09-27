import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { MemoryRouter } from "react-router";
import { beforeEach, expect, test, vi } from "vitest";
import PlanningRun from "./PlanningRun";
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
} from "./operationsApi";

vi.mock("./operationsApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./operationsApi")>()),
  getFlightSearchResults: vi.fn(),
  getOperations: vi.fn(),
  startFlightSearch: vi.fn(),
}));

const operation: TrackedOperation = {
  id: "operation",
  resourceId: "trip",
  type: "flightSearch",
  status: "pending",
  progress: { items: 2, completedItems: 0, failedItems: 0 },
  createdAt: "2030-01-01T12:00:00Z",
  updatedAt: "2030-01-01T12:00:00Z",
  pollingUrl: "/api/operations/operation",
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
  return render(
    <FluentProvider theme={webLightTheme}>
      <MemoryRouter>
        <PlanningRun
          tripId="trip"
          parties={parties}
          partySettings={settings}
          constraints={constraints}
          currentAiPrompt={currentAiPrompt}
          disabled={false}
          onBeforeSearch={save}
          onReviewRequirements={reviewRequirements}
        />
      </MemoryRouter>
    </FluentProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getOperations).mockResolvedValue([]);
  vi.mocked(getFlightSearchResults).mockResolvedValue([]);
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
  fireEvent.click(screen.getByRole("button", { name: "Review requirements" }));
  expect(reviewRequirements).toHaveBeenCalledWith("old-return");
});
