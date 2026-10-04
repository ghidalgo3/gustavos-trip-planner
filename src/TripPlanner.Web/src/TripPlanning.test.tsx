import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { MemoryRouter, useLocation } from "react-router";
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
function RouteQuery() {
  return <div data-testid="route-query">{useLocation().search}</div>;
}
function show(
  onSaved = vi.fn(),
  route = "/trips/trip",
  featureFlags: string[] = [],
  formOperations: { id: string; resourceId: string; status: string }[] = [],
  onOperationListRequest?: (url: string) => void,
) {
  const fetchMock = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/operations?")) {
        onOperationListRequest?.(url);
        return Promise.resolve({
          ok: true,
          json: async () =>
            url.includes("type=tripFormFill") ? formOperations : [],
        });
      }
      const response = await fetchMock(input, init);
      if (url.endsWith("/flights/constraints") || url.endsWith("/parties")) {
        const payload = await response.json();
        const body = url.endsWith("/parties")
          ? ((payload as { parties?: unknown[] }).parties ?? payload)
          : ((payload as { document?: unknown }).document ?? payload);
        return { ...response, json: async () => body };
      }
      return response;
    },
  );
  return render(
    <FluentProvider theme={webLightTheme}>
      <MemoryRouter initialEntries={[route]}>
        <TripPlanning
          trip={trip}
          userId={userId}
          featureFlags={featureFlags}
          onSaved={onSaved}
          onBack={vi.fn()}
        />
        <RouteQuery />
      </MemoryRouter>
    </FluentProvider>,
  );
}

test("AI form fill is flag gated and leaves a reviewable unsaved draft", async () => {
  const filled: PlanningDocument = {
    ...document,
    destination: {
      code: "LHR",
      timeZone: "Europe/London",
      label: "London · Heathrow (LHR)",
    },
    constraints: [
      ...document.constraints,
      { id: "nonstop", userId, type: "nonstop", countryCodes: [] },
    ],
  };
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/flights:prompt")) {
        expect(init?.method).toBe("POST");
        return {
          ok: true,
          json: async () => ({ id: "operation-1", status: "pending" }),
        };
      }
      if (String(input).endsWith("/operations/operation-1"))
        return {
          ok: true,
          json: async () => ({ id: "operation-1", status: "Completed" }),
        };
      if (String(input).endsWith("/flights/prompts/operation-1"))
        return {
          ok: true,
          json: async () => ({
            document: {
              ...filled,
              aiPrompt: "London, nonstop please",
              aiFormOperationId: "operation-1",
            },
            warnings: [],
          }),
        };
      if (String(input).endsWith("/constraints") && init?.method === "PUT")
        return { ok: true, json: async () => trip };
      return { ok: true, json: async () => ({ document, parties }) };
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  const first = show();
  await screen.findByRole("heading", { name: "Where and when?" });
  expect(
    screen.queryByRole("textbox", {
      name: "Trip description for AI assistance",
    }),
  ).not.toBeInTheDocument();
  first.unmount();
  show(vi.fn(), "/trips/trip", ["LLM"]);
  const text = await screen.findByRole("textbox", {
    name: "Trip description for AI assistance",
  });
  fireEvent.change(text, { target: { value: "London, nonstop please" } });
  fireEvent.click(screen.getByRole("button", { name: "Fill trip details" }));
  await waitFor(() =>
    expect(screen.getByRole("combobox", { name: "Destination" })).toHaveValue(
      "London · Heathrow (LHR)",
    ),
  );
  expect(
    await screen.findByRole("group", { name: "Requirement 3" }),
  ).toBeVisible();
  expect(screen.getByText("Unsaved changes")).toBeVisible();
  expect(text).toHaveAttribute("readonly");
  expect(text.closest(".trip-prompt-locked")).not.toBeNull();
  fireEvent.mouseEnter(text);
  expect(screen.getByRole("tooltip")).toHaveTextContent(
    "Later edits to trip details do not update this text",
  );
  fireEvent.mouseLeave(text);
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  fireEvent.click(text);
  expect(screen.getByRole("tooltip")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Plan again" }));
  expect(
    screen.getByText(/description and trip details will stay as they are/),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(text).toHaveAttribute("readonly");
  fireEvent.click(screen.getByRole("button", { name: "Plan again" }));
  fireEvent.click(screen.getByRole("button", { name: "Unlock description" }));
  await waitFor(() => expect(text).not.toHaveAttribute("readonly"));
  expect(text).toHaveValue("London, nonstop please");
  expect(screen.getByRole("combobox", { name: "Destination" })).toHaveValue(
    "London · Heathrow (LHR)",
  );
  expect(screen.getByRole("group", { name: "Requirement 3" })).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Fill trip details" }),
  ).toBeVisible();
  expect(
    fetchMock.mock.calls.filter(([url]) =>
      String(url).endsWith("/constraints"),
    ),
  ).toHaveLength(1);
  const unlocked = JSON.parse(
    fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith("/constraints"),
    )?.[1]?.body as string,
  ) as PlanningDocument;
  expect(unlocked.constraints).toHaveLength(3);
  expect(unlocked.aiPrompt).toBe("London, nonstop please");
  expect(unlocked.aiPromptLocked).toBe(false);
  fireEvent.change(text, { target: { value: "London, one stop is fine" } });
  fireEvent.click(
    screen.getByRole("button", { name: "Save planning details" }),
  );
  await waitFor(() =>
    expect(
      fetchMock.mock.calls.filter(([url]) =>
        String(url).endsWith("/constraints"),
      ),
    ).toHaveLength(2),
  );
  const edited = JSON.parse(
    fetchMock.mock.calls.filter(([url]) =>
      String(url).endsWith("/constraints"),
    )[1][1]?.body as string,
  ) as PlanningDocument;
  expect(edited.aiPrompt).toBe("London, one stop is fine");
});

test("shows a spinner while the AI form operation is running", async () => {
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/flights:prompt") && init?.method === "POST")
        return {
          ok: true,
          json: async () => ({ id: "operation-1", status: "pending" }),
        };
      if (url.endsWith("/operations/operation-1"))
        return {
          ok: true,
          json: async () => ({ id: "operation-1", status: "InProgress" }),
        };
      return { ok: true, json: async () => ({ document, parties }) };
    },
  );
  show(vi.fn(), "/trips/trip", ["LLM"]);
  const text = await screen.findByRole("textbox", {
    name: "Trip description for AI assistance",
  });
  fireEvent.change(text, { target: { value: "Paris in January" } });
  fireEvent.click(screen.getByRole("button", { name: "Fill trip details" }));
  expect(
    await screen.findByText("Filling trip details with AI…"),
  ).toBeVisible();
});

test("restores a completed form fill after returning to the trip", async () => {
  const filled: PlanningDocument = {
    ...document,
    aiPrompt: "Paris January 5 to 15",
    aiFormOperationId: "operation-1",
    travelDates: { startDate: "2030-01-05", endDate: "2030-01-15" },
  };
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/operations/operation-1"))
      return {
        ok: true,
        json: async () => ({ id: "operation-1", status: "Completed" }),
      };
    if (url.endsWith("/flights/prompts/operation-1"))
      return {
        ok: true,
        json: async () => ({ document: filled, warnings: [] }),
      };
    return { ok: true, json: async () => ({ document, parties }) };
  });
  show(
    vi.fn(),
    "/trips/trip",
    ["LLM"],
    [{ id: "operation-1", resourceId: trip.id, status: "Completed" }],
  );
  await waitFor(() =>
    expect(
      screen.getByRole("textbox", {
        name: "Trip description for AI assistance",
      }),
    ).toHaveValue("Paris January 5 to 15"),
  );
  expect(screen.getByRole("button", { name: "Plan again" })).toBeVisible();
});

test("an unlocked AI description stays editable after reopening the trip", async () => {
  const saved: PlanningDocument = {
    ...document,
    aiPrompt: "London, nonstop please",
    aiPromptLocked: false,
    aiFormOperationId: "operation-1",
  };
  vi.stubGlobal("fetch", async () => ({
    ok: true,
    json: async () => ({ document: saved, parties }),
  }));
  show(
    vi.fn(),
    "/trips/trip",
    ["LLM"],
    [{ id: "operation-1", resourceId: trip.id, status: "Completed" }],
  );
  const text = await screen.findByRole("textbox", {
    name: "Trip description for AI assistance",
  });
  expect(text).toHaveValue("London, nonstop please");
  expect(text).not.toHaveAttribute("readonly");
  expect(
    screen.getByRole("button", { name: "Fill trip details" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Plan again" }),
  ).not.toBeInTheDocument();
});

test("editing the AI description does not repeat operation recovery requests", async () => {
  vi.stubGlobal("fetch", async () => ({
    ok: true,
    json: async () => ({ document, parties }),
  }));
  const operationRequests: string[] = [];
  show(vi.fn(), "/trips/trip", ["LLM"], [], (url) =>
    operationRequests.push(url),
  );
  const text = await screen.findByRole("textbox", {
    name: "Trip description for AI assistance",
  });
  await waitFor(() =>
    expect(
      operationRequests.filter((url) => url.includes("type=tripFormFill")),
    ).toHaveLength(1),
  );
  for (const value of ["P", "Pa", "Paris"])
    fireEvent.change(text, { target: { value } });
  expect(text).toHaveValue("Paris");
  expect(
    operationRequests.filter((url) => url.includes("type=tripFormFill")),
  ).toHaveLength(1);
});

test("restores and toggles the advanced panel through the route", async () => {
  vi.stubGlobal("fetch", async () => ({
    ok: true,
    json: async () => ({ document, parties }),
  }));
  show(vi.fn(), "/trips/trip?advanced=1");
  const toggle = await screen.findByRole("button", {
    name: "Advanced",
  });
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(screen.getByTestId("route-query")).not.toHaveTextContent("advanced");
});

test("loads and saves an airport suggestion", async () => {
  let stored = structuredClone(document);
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url.includes("/airports?"))
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
      expect(url).toContain("/trips/trip/");
      if (url.endsWith("/flights/constraints"))
        return { ok: true, json: async () => stored };
      if (url.endsWith("/parties"))
        return { ok: true, json: async () => parties };
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
  expect(screen.getByRole("button", { name: "Find flights" })).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Preview flight searches" }),
  ).not.toBeInTheDocument();
  fireEvent.change(destination, { target: { value: "London" } });
  expect(destination).toHaveValue("London");
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

test("selecting a city searches all its airports and allows removing one", async () => {
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/airports?"))
        return {
          ok: true,
          json: async () =>
            ["JFK", "EWR"].map((code) => ({
              code,
              city: "New York",
              name: code === "JFK" ? "John F Kennedy" : "Newark Liberty",
              country: "US",
              location: {
                code,
                label: `New York · ${code} (${code})`,
                timeZone: "America/New_York",
              },
            })),
        };
      if (url.endsWith("/constraints") && init?.method === "PUT")
        return { ok: true, json: async () => trip };
      return { ok: true, json: async () => ({ document, parties }) };
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  show();
  const destination = await screen.findByRole("combobox", {
    name: "Destination",
  });
  fireEvent.change(destination, { target: { value: "New York" } });
  fireEvent.click(
    await screen.findByRole("option", { name: /New York, US.*all airports/ }),
  );
  expect(screen.getByText("Searching JFK, EWR")).toBeVisible();
  fireEvent.click(
    screen.getByRole("button", { name: "Remove EWR from Destination" }),
  );
  expect(screen.getByText("Searching JFK")).toBeVisible();
  fireEvent.click(
    screen.getByRole("button", { name: "Save planning details" }),
  );
  await waitFor(() =>
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === "PUT"),
    ).toBe(true),
  );
  const saved = JSON.parse(
    fetchMock.mock.calls.find(([, init]) => init?.method === "PUT")?.[1]
      ?.body as string,
  ) as PlanningDocument;
  expect(saved.destination?.codes).toEqual(["JFK"]);
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
  fireEvent.click(await screen.findByRole("button", { name: "Advanced" }));
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
  fireEvent.click(await screen.findByRole("button", { name: "Advanced" }));
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
  expect(
    screen.getByRole("combobox", { name: "Departure airport" }),
  ).toHaveValue("Boston · Logan (BOS)");
  expect(screen.queryByLabelText("Cabin")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
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
  fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
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

test("shows compact party selection before the destination", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ document, parties }),
    })),
  );
  show();
  const selector = await screen.findByLabelText("Party 1");
  expect(
    within(selector).getByRole("combobox", { name: "Add traveler" }),
  ).toBeVisible();
  expect(within(selector).getByText("Ada (you)")).toBeVisible();
  expect(
    within(selector).queryByRole("button", { name: /Remove/ }),
  ).not.toBeInTheDocument();
  expect(
    selector.compareDocumentPosition(
      screen.getByRole("heading", { name: "Where and when?" }),
    ),
  ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
});

test("searches users by name and adds and removes a party member", async () => {
  const traveler = {
    id: "33333333-3333-3333-3333-333333333333",
    name: "Alice Smith",
    email: "alice@example.com",
  };
  let members = [...parties[0].members];
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/users?query="))
        return { ok: true, json: async () => [traveler] };
      if (url.endsWith(`/members/${traveler.id}`)) {
        if (init?.method === "PUT")
          members = [
            ...members,
            { id: traveler.id, name: traveler.name, homeCity: "Seattle" },
          ];
        else if (init?.method === "DELETE")
          members = members.filter((member) => member.id !== traveler.id);
        return { ok: true, status: 204 };
      }
      if (url.endsWith("/flights/constraints"))
        return {
          ok: true,
          json: async () => document,
        };
      if (url.endsWith("/parties"))
        return { ok: true, json: async () => [{ ...parties[0], members }] };
      throw new Error(`Unexpected request: ${url}`);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  show();
  const input = await screen.findByRole("combobox", { name: "Add traveler" });
  fireEvent.change(input, { target: { value: "Alice" } });
  fireEvent.click(await screen.findByRole("option", { name: /Alice Smith/ }));
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  expect(await screen.findByText("Alice Smith")).toBeVisible();
  fireEvent.click(
    screen.getByRole("button", { name: "Remove Alice Smith from party" }),
  );
  await waitFor(() =>
    expect(screen.queryByText("Alice Smith")).not.toBeInTheDocument(),
  );
  expect(
    fetchMock.mock.calls.some(
      ([url, init]) =>
        String(url).endsWith(`/members/${traveler.id}`) &&
        init?.method === "PUT",
    ),
  ).toBe(true);
  expect(
    fetchMock.mock.calls.some(
      ([url, init]) =>
        String(url).endsWith(`/members/${traveler.id}`) &&
        init?.method === "DELETE",
    ),
  ).toBe(true);
});
