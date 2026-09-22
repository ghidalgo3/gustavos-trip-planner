import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { expect, test, vi } from "vitest";
import TripPlanning from "./TripPlanning";
import type { Trip } from "./api";
import type { PlanningDocument } from "./planningApi";

const userId = "11111111-1111-1111-1111-111111111111";
const partyId = "22222222-2222-2222-2222-222222222222";
const trip: Trip = {
  id: "trip",
  ownerUserId: userId,
  name: "Paris spring",
  description: "",
  constraints: {},
  createdAt: "",
  updatedAt: "",
};
const document: PlanningDocument = {
  schemaVersion: 1,
  travelDates: { startDate: "2030-01-05", endDate: "2030-01-15" },
  destination: { code: "CDG", timeZone: "Europe/Paris" },
  parties: [
    {
      partyId,
      origin: { code: "BOS", timeZone: "America/New_York" },
      market: "US",
      cabin: "economy",
      maxJourneyHours: 48,
      maxStops: null,
      preferredAirlines: [],
    },
  ],
  constraints: [
    {
      id: "departure",
      userId,
      type: "departureWindow",
      window: { earliest: "2030-01-05", latest: "2030-01-05", preferred: null },
      countryCodes: [],
    },
    {
      id: "home",
      userId,
      type: "returnHomeWindow",
      window: { earliest: "2030-01-15", latest: "2030-01-15", preferred: null },
      countryCodes: [],
    },
  ],
};
const parties = [
  { id: partyId, members: [{ id: userId, name: "Ada", homeCity: "Boston" }] },
];
function show(onSaved = vi.fn()) {
  const fetchMock = globalThis.fetch;
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
    String(input).includes("/api/operations?")
      ? Promise.resolve({ ok: true, json: async () => [] })
      : fetchMock(input, init),
  );
  return render(
    <FluentProvider theme={webLightTheme}>
      <TripPlanning
        trip={trip}
        userId={userId}
        onSaved={onSaved}
        onBack={vi.fn()}
      />
    </FluentProvider>,
  );
}

test("loads and saves an airport suggestion", async () => {
  let stored = structuredClone(document);
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url.includes("/api/airports?"))
        return {
          ok: true,
          json: async () => [
            {
              code: "LHR",
              city: "London",
              name: "Heathrow",
              country: "GB",
              location: {
                code: "LHR",
                label: "London · Heathrow (LHR)",
                timeZone: "Europe/London",
              },
            },
          ],
        };
      expect(url).toContain("/api/user/" + userId + "/trips/trip/");
      if (url.endsWith("/planning"))
        return { ok: true, json: async () => ({ document: stored, parties }) };
      if (url.endsWith("/constraints")) {
        expect(init?.method).toBe("PUT");
        stored = JSON.parse(init?.body as string);
        return {
          ok: true,
          json: async () => ({ ...trip, constraints: stored }),
        };
      }
      throw new Error("Unexpected request");
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  const onSaved = vi.fn();
  const first = show(onSaved);
  const destination = await screen.findByRole("combobox", {
    name: "Destination",
  });
  expect(screen.getByRole("button", { name: "Plan trip" })).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Preview flight searches" }),
  ).not.toBeInTheDocument();
  fireEvent.change(destination, { target: { value: "London" } });
  expect(
    screen.getByText("Choose an airport from the suggestions to continue"),
  ).toBeVisible();
  fireEvent.click(
    await screen.findByRole("option", { name: /London.*Heathrow/ }),
  );
  fireEvent.mouseDown(screen.getByRole("button", { name: "Open Destination" }));
  expect(destination).toHaveValue("London · Heathrow (LHR)");
  expect(screen.getByRole("heading", { name: "Paris spring" })).toBeVisible();
  expect(
    screen.getByRole("option", { name: /London.*Heathrow/ }),
  ).toBeVisible();
  expect(screen.queryByLabelText(/time zone/i)).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Save planning details" }),
  );
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Planning details saved.",
  );
  expect(onSaved).toHaveBeenCalledTimes(1);
  first.unmount();
  show();
  expect(
    await screen.findByRole("combobox", {
      name: "Destination",
    }),
  ).toHaveValue("London · Heathrow (LHR)");
});

test("departure and return-flight flexibility are independent", async () => {
  const fetchMock = vi.fn(
    async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PUT") return { ok: true, json: async () => trip };
      return { ok: true, json: async () => ({ document, parties }) };
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  show();
  const departure = await screen.findByRole("group", { name: "Requirement 1" });
  const home = screen.getByRole("group", { name: "Requirement 2" });
  fireEvent.click(within(departure).getByRole("checkbox"));
  fireEvent.change(within(departure).getByRole("spinbutton"), {
    target: { value: "2" },
  });
  fireEvent.click(within(home).getByRole("checkbox"));
  fireEvent.change(within(home).getByRole("spinbutton"), {
    target: { value: "4" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Save planning details" }),
  );
  await screen.findByText("Planning details saved.");
  const request = fetchMock.mock.calls.find(
    ([, init]) => init?.method === "PUT",
  )?.[1];
  const body = JSON.parse(request?.body as string) as PlanningDocument;
  expect(body.constraints[0].window).toEqual({
    preferred: "2030-01-05",
    earliest: "2030-01-03",
    latest: "2030-01-07",
  });
  expect(body.constraints[1].window).toEqual({
    preferred: "2030-01-15",
    earliest: "2030-01-11",
    latest: "2030-01-19",
  });
});

test("supports adding and removing requirements", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ document, parties }),
    })),
  );
  show();
  await screen.findByRole("group", { name: "Requirement 1" });
  fireEvent.click(screen.getByRole("button", { name: "Add requirement" }));
  const added = screen.getByRole("group", { name: "Requirement 3" });
  fireEvent.change(
    within(added).getByRole("combobox", { name: "Requirement 3" }),
    { target: { value: "presence" } },
  );
  expect(within(added).getByLabelText("Be there on or before")).toBeVisible();
  fireEvent.click(
    within(added).getByRole("button", { name: "Remove requirement 3" }),
  );
  expect(
    screen.queryByRole("group", { name: "Requirement 3" }),
  ).not.toBeInTheDocument();
});

test("a failed save preserves inputs and displays the validation error", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === "PUT"
        ? {
            ok: false,
            status: 400,
            json: async () => ({
              title: "Check constraints",
              issues: [
                {
                  message: "Return-flight date must be on or after departure.",
                },
              ],
            }),
          }
        : { ok: true, json: async () => ({ document, parties }) },
    ),
  );
  show();
  const date = await screen.findByLabelText("Return flight date");
  fireEvent.change(date, { target: { value: "2030-01-01" } });
  fireEvent.click(
    screen.getByRole("button", { name: "Save planning details" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Return-flight date must be on or after departure.",
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Save planning details" }),
    ).toBeEnabled(),
  );
  expect(date).toHaveValue("2030-01-01");
});

test("uses calendar dates and a suggested home airport without requiring constraints; advanced filters are optional", async () => {
  const fetchMock = vi.fn(
    async (_input: RequestInfo | URL, init?: RequestInit) => ({
      ok: true,
      json: async () =>
        init?.method === "PUT"
          ? trip
          : {
              document: {
                schemaVersion: 1,
                destination: document.destination,
                parties: [],
                constraints: [],
              },
              parties: [
                {
                  ...parties[0],
                  suggestedOrigin: {
                    code: "BOS",
                    timeZone: "America/New_York",
                    label: "Boston · Logan (BOS)",
                  },
                },
              ],
            },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  show();
  const start = await screen.findByLabelText("Departure date");
  const end = screen.getByLabelText("Return flight date");
  expect(start).toHaveAttribute("type", "date");
  expect(end).toHaveAttribute("type", "date");
  expect(screen.getByRole("combobox", { name: "Party 1 origin" })).toHaveValue(
    "Boston · Logan (BOS)",
  );
  expect(screen.queryByLabelText("Cabin")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Advanced filters" }));
  expect(screen.getByLabelText("Cabin")).toBeVisible();
  expect(screen.getByLabelText("Pricing market")).toBeVisible();
  expect(
    within(
      screen
        .getByRole("heading", { name: "Where and when?" })
        .closest(".planning-card")!,
    ).getByLabelText("Cabin"),
  ).toBeVisible();
  fireEvent.change(screen.getByLabelText("Cabin"), {
    target: { value: "business" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Advanced filters" }));
  expect(screen.queryByLabelText("Cabin")).not.toBeInTheDocument();
  fireEvent.change(start, { target: { value: "2030-01-05" } });
  fireEvent.change(end, { target: { value: "2030-01-15" } });
  fireEvent.click(
    screen.getByRole("button", { name: "Save planning details" }),
  );
  await screen.findByText("Planning details saved.");
  const body = JSON.parse(
    fetchMock.mock.calls.find(([, init]) => init?.method === "PUT")![1]!
      .body as string,
  ) as PlanningDocument;
  expect(body.constraints).toEqual([]);
  expect(body.travelDates).toEqual({
    startDate: "2030-01-05",
    endDate: "2030-01-15",
  });
  expect(body.userTimeZone).toBe(
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  expect(body.parties[0].origin?.code).toBe("BOS");
  expect(body.parties[0].cabin).toBe("business");
});

test("shows an invitation placeholder for each party", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ document, parties }),
    })),
  );
  show();
  fireEvent.click(
    await screen.findByRole("button", { name: "Invite someone to Party 1" }),
  );
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Inviting travelers is coming soon.",
  );
});
