import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { MemoryRouter, useLocation } from "react-router";
import { beforeEach, expect, test, vi } from "vitest";
import TripsDashboard from "./TripsDashboard";
import type { Trip } from "../../api/api";
import { trackBehavior } from "../../telemetry/telemetry";
import { memoryStorage } from "../../test/memoryStorage";
import {
  documentKey,
  rememberTripCatalog,
  readTripCatalog,
} from "../../api/offlineCache";

vi.mock("../../telemetry/telemetry", () => ({ trackBehavior: vi.fn() }));
beforeEach(() => {
  vi.mocked(trackBehavior).mockClear();
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("sessionStorage", memoryStorage());
});

const user = {
  isAuthenticated: true,
  completedOnboarding: true,
  id: "d8612b89-4343-4a30-aed4-6b7f2f8c8123",
  name: "Ada Traveler",
  email: "ada@example.com",
  profile: {
    homeCity: { name: "Boston", longitude: -71, latitude: 42 },
    preferredAirlines: [],
  },
};

function RouteState() {
  const location = useLocation();
  return (
    <output data-testid="route">{location.pathname + location.search}</output>
  );
}

test("creates, edits, and deletes a trip", async () => {
  let storedTrip: Trip | undefined;
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      const method = init?.method ?? "GET";
      expect(url).toContain(`/user/${user.id}/trips`);

      if (method === "GET") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            trips: storedTrip ? [storedTrip] : [],
            hasMore: false,
          }),
        };
      }
      if (method === "POST") {
        expect(JSON.parse(init?.body as string)).toEqual({
          name: "Lisbon summer",
          description: "Food and museums",
        });
        storedTrip = trip("Lisbon summer", "Food and museums");
        return { ok: true, status: 201, json: async () => storedTrip };
      }
      if (method === "PUT") {
        expect(url.endsWith("/trip-1")).toBe(true);
        const input = JSON.parse(init?.body as string);
        expect(input.name).toBe("Lisbon and Porto");
        expect(["Food and museums", "Travel by train"]).toContain(
          input.description,
        );
        storedTrip = trip(input.name, input.description);
        return { ok: true, status: 200, json: async () => storedTrip };
      }
      if (method === "DELETE") {
        expect(url.endsWith("/trip-1")).toBe(true);
        storedTrip = undefined;
        return { ok: true, status: 204 };
      }

      throw new Error(`Unexpected ${method} request: ${url}`);
    },
  );
  vi.stubGlobal("fetch", fetchMock);

  render(
    <FluentProvider theme={webLightTheme}>
      <MemoryRouter>
        <RouteState />
        <TripsDashboard user={user} />
      </MemoryRouter>
    </FluentProvider>,
  );

  expect(await screen.findByText("No upcoming trips")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "New trip" }));
  expect(screen.getByTestId("route")).toHaveTextContent("/?create=1");
  fireEvent.change(screen.getByRole("textbox", { name: "Trip name" }), {
    target: { value: "Lisbon summer" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Description" }), {
    target: { value: "Food and museums" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create trip" }));

  expect(
    await screen.findByRole("heading", { name: "Lisbon summer" }),
  ).toBeVisible();
  expect(trackBehavior).toHaveBeenCalledWith("trip_creation_submitted");
  expect(trackBehavior).toHaveBeenCalledWith("trip_created");
  expect(trackBehavior).not.toHaveBeenCalledWith("trip_creation_failed");
  expect(
    screen.queryByRole("button", { name: "Find flights" }),
  ).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("link", { name: "Open trip: Lisbon summer" }),
  );
  expect(screen.getByTestId("route")).toHaveTextContent("/trips/trip-1");
  fireEvent.click(
    screen.getByRole("button", { name: "Options for Lisbon summer" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  expect(screen.getByTestId("route")).toHaveTextContent(
    "/trips/trip-1?edit=trip-1",
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Trip name" }), {
    target: { value: "Lisbon and Porto" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Description" }), {
    target: { value: "Travel by train" },
  });
  fireEvent.blur(screen.getByRole("textbox", { name: "Trip name" }));
  await waitFor(() =>
    expect(screen.getByRole("textbox", { name: "Description" })).toBeEnabled(),
  );
  fireEvent.blur(screen.getByRole("textbox", { name: "Description" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Done" })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Done" }));

  expect(
    await screen.findByRole("heading", { name: "Lisbon and Porto" }),
  ).toBeVisible();
  expect(screen.getByText("Travel by train")).toBeVisible();
  fireEvent.click(
    screen.getByRole("button", { name: "Options for Lisbon and Porto" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  expect(screen.getByRole("dialog", { name: "Delete trip?" })).toBeVisible();
  expect(
    screen.getByRole("dialog", { name: "Delete trip?" }),
  ).toHaveTextContent(/Lisbon and Porto.*planning details/);
  expect(
    fetchMock.mock.calls.filter(([, init]) => init?.method === "DELETE"),
  ).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(
    screen.queryByRole("dialog", { name: "Delete trip?" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: "Lisbon and Porto" }),
  ).toBeVisible();
  fireEvent.click(
    screen.getByRole("button", { name: "Options for Lisbon and Porto" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  fireEvent.click(screen.getByRole("button", { name: "Delete trip" }));

  await waitFor(() =>
    expect(
      screen.queryByRole("heading", { name: "Lisbon and Porto" }),
    ).not.toBeInTheDocument(),
  );
  expect(
    fetchMock.mock.calls.filter(([, init]) => init?.method === "DELETE"),
  ).toHaveLength(1);
});

test("opens an existing trip editor directly from the URL", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        trips: [trip("Paris spring", "Museums")],
        hasMore: false,
      }),
    })),
  );

  render(
    <FluentProvider theme={webLightTheme}>
      <MemoryRouter initialEntries={["/?edit=trip-1"]}>
        <TripsDashboard user={user} />
      </MemoryRouter>
    </FluentProvider>,
  );

  expect(await screen.findByRole("textbox", { name: "Trip name" })).toHaveValue(
    "Paris spring",
  );
  expect(screen.getByRole("textbox", { name: "Description" })).toHaveValue(
    "Museums",
  );
});

test("failed saves do not count as successful funnel conversions", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST")
        return {
          ok: false,
          status: 500,
          json: async () => ({ title: "Save failed" }),
        };
      return { ok: true, json: async () => ({ trips: [], hasMore: false }) };
    }),
  );
  render(
    <FluentProvider theme={webLightTheme}>
      <MemoryRouter initialEntries={["/?create=1"]}>
        <TripsDashboard user={user} />
      </MemoryRouter>
    </FluentProvider>,
  );
  fireEvent.change(await screen.findByRole("textbox", { name: "Trip name" }), {
    target: { value: "Private trip name" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create trip" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Save failed");
  expect(trackBehavior).toHaveBeenCalledWith("trip_creation_failed");
  expect(trackBehavior).not.toHaveBeenCalledWith("trip_created");
  expect(JSON.stringify(vi.mocked(trackBehavior).mock.calls)).not.toContain(
    "Private trip name",
  );
});

function trip(name: string, description: string): Trip {
  return {
    id: "trip-1",
    ownerUserId: user.id,
    name,
    description,
    constraints: {},
    createdAt: "2026-09-20T12:00:00Z",
    updatedAt: "2026-09-20T12:00:00Z",
  };
}

function renderDashboard(offline = false) {
  return render(
    <FluentProvider theme={webLightTheme}>
      <MemoryRouter>
        <TripsDashboard user={user} offline={offline} />
      </MemoryRouter>
    </FluentProvider>,
  );
}

function mockPagedTrips() {
  const all = Array.from({ length: 25 }, (_, index) => ({
    ...trip(`Trip ${String(index).padStart(2, "0")}`, ""),
    id: `trip-${index}`,
  }));
  const network = vi.fn(async (input: RequestInfo | URL) => {
    const query = new URL(input.toString(), "http://localhost").searchParams;
    if (query.get("past") === "true")
      return { ok: true, json: async () => ({ trips: [], hasMore: false }) };
    expect(query.get("today")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const skip = Number(query.get("skip"));
    const matching = all.filter((trip) =>
      trip.name.toLowerCase().includes(query.get("search")!.toLowerCase()),
    );
    return {
      ok: true,
      json: async () => ({
        trips: matching.slice(skip, skip + 10),
        hasMore: matching.length > skip + 10,
      }),
    };
  });
  vi.stubGlobal("fetch", network);
  return network;
}

test("loads ten trips per request until there are no more results", async () => {
  const network = mockPagedTrips();
  renderDashboard();
  await screen.findByRole("heading", { name: "Trip 00" });
  expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(10);
  expect(
    screen.queryByText(/Welcome back|YOUR TRIPS|Available offline/),
  ).not.toBeInTheDocument();
  expect(network).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Load more" }));
  await screen.findByText("Trip 19");
  expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(20);
  fireEvent.click(screen.getByRole("button", { name: "Load more" }));
  await screen.findByText("Trip 24");
  expect(
    screen.queryByRole("button", { name: "Load more" }),
  ).not.toBeInTheDocument();

  expect(readTripCatalog(user.id)).toHaveLength(25);
});

test("searches names beyond the loaded page and resets the request offset", async () => {
  const network = mockPagedTrips();
  renderDashboard();
  await screen.findByText("Trip 00");
  fireEvent.change(screen.getByRole("searchbox", { name: "Search trips" }), {
    target: { value: "TRIP 24" },
  });
  await waitFor(() =>
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(1),
  );
  expect(
    new URL(
      network.mock.calls.at(-1)![0].toString(),
      "http://localhost",
    ).searchParams.get("skip"),
  ).toBe("0");
  fireEvent.change(screen.getByRole("searchbox", { name: "Search trips" }), {
    target: { value: "missing" },
  });
  expect(await screen.findByText("No matching upcoming trips")).toBeVisible();
  expect(readTripCatalog(user.id)).toHaveLength(11);
});

test("past trips start collapsed, load on expansion, and show dates", async () => {
  const currentTrip = {
    ...trip("Next trip", ""),
    startDate: "2030-07-10",
    endDate: "2030-07-12",
  };
  const pastTrip = {
    ...trip("Old trip", ""),
    id: "old",
    startDate: "2020-01-02",
    endDate: "2020-01-05",
  };
  const network = vi.fn(async (input: RequestInfo | URL) => ({
    ok: true,
    json: async () => ({
      trips:
        new URL(input.toString(), "http://localhost").searchParams.get(
          "past",
        ) === "true"
          ? [pastTrip]
          : [currentTrip],
      hasMore: false,
    }),
  }));
  vi.stubGlobal("fetch", network);
  renderDashboard();
  await screen.findByRole("heading", { name: "Next trip" });
  expect(screen.getByText(/Jul 10, 2030.*Jul 12, 2030/)).toBeVisible();
  const toggle = screen.getByRole("button", {
    name: "Past trips",
  });
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(
    screen.queryByRole("heading", { name: "Old trip" }),
  ).not.toBeInTheDocument();
  expect(network).toHaveBeenCalledTimes(1);
  fireEvent.click(toggle);
  expect(
    await screen.findByRole("heading", { name: "Old trip" }),
  ).toBeVisible();
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  expect(
    within(screen.getByRole("region", { name: "Past trips" })).getByText(
      /Jan 2, 2020.*Jan 5, 2020/,
    ),
  ).toBeVisible();
  fireEvent.click(toggle);
  expect(
    screen.queryByRole("heading", { name: "Old trip" }),
  ).not.toBeInTheDocument();
});

test("a failed next page retains cards and allows a retry without overlapping requests", async () => {
  let fail = true;
  const network = vi.fn(async (input: RequestInfo | URL) => {
    const skip = new URL(input.toString(), "http://localhost").searchParams.get(
      "skip",
    );
    if (skip !== "0" && fail)
      return {
        ok: false,
        status: 500,
        json: async () => ({ title: "Try loading again" }),
      };
    return {
      ok: true,
      json: async () => ({
        trips: Array.from({ length: 10 }, (_, index) => ({
          ...trip(`Trip ${Number(skip) + index}`, ""),
          id: `trip-${Number(skip) + index}`,
        })),
        hasMore: skip === "0",
      }),
    };
  });
  vi.stubGlobal("fetch", network);
  renderDashboard();
  await screen.findByRole("heading", { name: "Trip 0" });
  const more = screen.getByRole("button", { name: "Load more" });
  fireEvent.click(more);
  fireEvent.click(more);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Try loading again",
  );
  expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(10);
  expect(network).toHaveBeenCalledTimes(2);
  fail = false;
  fireEvent.click(screen.getByRole("button", { name: "Load more" }));
  expect(await screen.findByText("Trip 19")).toBeVisible();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("offline keeps search, date ordering, past sections, and paging while disabling edits", async () => {
  const all = Array.from({ length: 15 }, (_, index) => ({
    ...trip(`Saved ${String(index).padStart(2, "0")}`, ""),
    id: `saved-${index}`,
  }));
  rememberTripCatalog(user.id, [
    ...all,
    {
      ...trip("Past saved", ""),
      id: "past",
      startDate: "2020-01-01",
      endDate: "2020-01-02",
    },
  ]);
  localStorage.setItem(
    documentKey(user.id, all[0].id),
    JSON.stringify({ document: { schemaVersion: 1, id: all[0].id } }),
  );
  const network = vi.fn();
  vi.stubGlobal("fetch", network);
  renderDashboard(true);
  await screen.findByRole("heading", { name: "Saved 00" });
  expect(screen.getByRole("button", { name: "New trip" })).toBeDisabled();
  expect(
    screen.getByRole("link", { name: "Open trip: Saved 00" }),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Options for Saved 00" }),
  ).toHaveAttribute("aria-disabled", "true");
  expect(screen.getAllByRole("heading")).toHaveLength(10);
  fireEvent.click(screen.getByRole("button", { name: "Load more" }));
  await screen.findByRole("heading", { name: "Saved 14" });
  fireEvent.change(screen.getByRole("searchbox", { name: "Search trips" }), {
    target: { value: "Saved 14" },
  });
  await waitFor(() => expect(screen.getAllByRole("heading")).toHaveLength(1));
  fireEvent.change(screen.getByRole("searchbox", { name: "Search trips" }), {
    target: { value: "" },
  });
  await screen.findByRole("heading", { name: "Saved 00" });
  expect(
    await screen.findByRole("heading", { name: "Past saved" }),
  ).toBeVisible();
  expect(network).not.toHaveBeenCalled();
  expect(screen.queryByText("Available offline")).not.toBeInTheDocument();
});
