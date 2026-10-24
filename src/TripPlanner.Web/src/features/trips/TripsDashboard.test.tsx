import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { MemoryRouter, useLocation } from "react-router";
import { beforeEach, expect, test, vi } from "vitest";
import TripsDashboard from "./TripsDashboard";
import type { Trip } from "../../api/api";
import { trackBehavior } from "../../telemetry/telemetry";

vi.mock("../../telemetry/telemetry", () => ({ trackBehavior: vi.fn() }));
beforeEach(() => vi.mocked(trackBehavior).mockClear());

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
        return { ok: true, status: 200, json: async () => [] };
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
        expect(JSON.parse(init?.body as string)).toEqual({
          name: "Lisbon and Porto",
          description: "Travel by train",
        });
        storedTrip = trip("Lisbon and Porto", "Travel by train");
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

  expect(await screen.findByText("No trips yet")).toBeVisible();
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
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

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
  expect(fetchMock).toHaveBeenCalledTimes(4);
});

test("opens an existing trip editor directly from the URL", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => [trip("Paris spring", "Museums")],
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
      return { ok: true, json: async () => [] };
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
