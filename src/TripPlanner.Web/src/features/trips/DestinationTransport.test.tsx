import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, expect, test, vi } from "vitest";
import ColorSchemeProvider from "../../app/ColorSchemeProvider";
import DestinationTransport from "./DestinationTransport";
import {
  transportForLeg,
  type TransportStop,
} from "./destinationTransportModel";
import {
  estimateTransportation,
  listTransportation,
  saveTransportation,
  type Transportation,
} from "./transportationApi";
import { mapsClient } from "../../maps/mapsClient";
import { useContext } from "react";
import { FlightMapPreviewContext } from "../flights/FlightMapPreviewContext";
import { searchAirports } from "../flights/planningApi";

vi.mock("../../maps/ActivityMap", () => ({
  default: ({
    landmarks,
    placeSearch,
    route,
  }: {
    landmarks: { id: string; label: string }[];
    placeSearch?: {
      results: { label: string }[];
      onSelect: (index: number) => void;
    };
    route?: unknown;
  }) => (
    <div role="img" aria-label="Transport map preview">
      {landmarks.map((landmark) => (
        <span key={landmark.id}>{landmark.label}</span>
      ))}
      {placeSearch?.results.map((place, index) => (
        <button key={index} onClick={() => placeSearch.onSelect(index)}>
          Map result {index + 1}. {place.label}
        </button>
      ))}
      {Boolean(route) && (
        <span data-testid="route-preview">{JSON.stringify(route)}</span>
      )}
    </div>
  ),
}));
vi.mock("../flights/planningApi", () => ({ searchAirports: vi.fn() }));
vi.mock("../flights/TripPlanning", () => ({
  default: function PreviewPlanner() {
    const preview = useContext(FlightMapPreviewContext);
    const flight = {
      segments: [
        {
          departure_airport: "ATL",
          arrival_airport: "JFK",
          departure_time_local: "2030-05-01T08:00:00",
          arrival_time_local: "2030-05-01T10:00:00",
        },
        {
          departure_airport: "JFK",
          arrival_airport: "LHR",
          departure_time_local: "2030-05-01T12:00:00",
          arrival_time_local: "2030-05-01T22:00:00",
        },
      ],
    };
    return (
      <section aria-label="Flight planning">
        <button>Search flights</button>
        <button
          onMouseEnter={() => preview?.onHover(flight)}
          onMouseLeave={() => preview?.onHover(undefined)}
        >
          Preview connecting flight
        </button>
      </section>
    );
  },
}));

vi.mock("./transportationApi", () => ({
  listTransportation: vi.fn(),
  saveTransportation: vi.fn(),
  estimateTransportation: vi.fn(),
}));
vi.mock("../../maps/mapsClient", () => ({
  mapsClient: { searchPlaces: vi.fn() },
}));
const stop: TransportStop = {
  city: "Paris",
  stayId: "paris",
  date: "2030-04-01",
  destination: {
    type: "Feature",
    id: "paris",
    geometry: { type: "Point", coordinates: [2.35, 48.86] },
    properties: {
      name: "Paris",
      countryCode: "FR",
      timeZone: "Europe/Paris",
      stays: [],
      constraints: {},
      contextVersion: "0",
      arrivalDate: null,
      departureDate: null,
      isActive: true,
    },
  },
} as TransportStop;
const target: TransportStop = {
  ...stop,
  city: "Lyon",
  stayId: "lyon",
  destination: {
    ...stop.destination!,
    id: "lyon",
    properties: { ...stop.destination!.properties, name: "Lyon" },
  },
};
const value: Transportation = {
  type: "FeatureCollection",
  id: "transport",
  name: "Paris to Lyon",
  notes: "Bring tickets",
  features: [
    {
      type: "Feature",
      id: "from",
      geometry: stop.destination!.geometry,
      properties: { name: "Gare de Lyon" },
    },
    {
      type: "Feature",
      id: "to",
      geometry: target.destination!.geometry,
      properties: { name: "Part Dieu" },
    },
    {
      type: "Feature",
      id: "step",
      geometry: null,
      properties: { mode: "train", sequence: 0, instructions: "Platform 2" },
    },
  ],
  mode: "train",
  departureDate: null,
  departureTime: null,
  timeZone: "Europe/Paris",
  duration: "PT2H",
  version: 4,
  etag: "transport-4",
  routeStale: false,
  originStayId: "paris",
  destinationStayId: "lyon",
  departureAt: "2030-04-01T07:00:00Z",
  arrivalAt: "2030-04-01T09:00:00Z",
};
function show(readOnly = false) {
  render(
    <ColorSchemeProvider>
      <MemoryRouter>
        <ol>
          <DestinationTransport
            tripId="trip"
            from={stop}
            to={target}
            readOnly={readOnly}
            flights=""
            homeUserId="user"
          />
        </ol>
      </MemoryRouter>
    </ColorSchemeProvider>,
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(listTransportation).mockResolvedValue({ data: [], etag: "" });
  vi.mocked(saveTransportation).mockImplementation(async (_, v) => ({
    data: { ...v, id: "saved" },
    etag: "saved",
  }));
  vi.mocked(estimateTransportation).mockResolvedValue({
    data: {
      duration: "PT45M",
      geometry: {
        type: "MultiLineString",
        coordinates: [
          [
            [2.35, 48.86],
            [4.83, 45.76],
          ],
        ],
      },
    },
    etag: "",
  });
});
test("visit identities distinguish repeated cities and opposite directions", () => {
  expect(transportForLeg([value], "paris", "lyon")).toEqual(value);
  expect(transportForLeg([value], "lyon", "paris")).toBeUndefined();
  expect(transportForLeg([value], "paris-return", "lyon")).toBeUndefined();
});
test.each([
  ["Car", "car"],
  ["Walking", "walk"],
])(
  "%s estimates and saves a complete resource after pressing Save",
  async (label, mode) => {
    show();
    fireEvent.click(
      await screen.findByRole("button", { name: /Choose transportation/ }),
    );
    fireEvent.click(screen.getByRole("tab", { name: label }));
    expect(estimateTransportation).not.toHaveBeenCalled();
    expect(saveTransportation).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saveTransportation).toHaveBeenCalled());
    expect(estimateTransportation).toHaveBeenCalledWith(
      "trip",
      stop.destination!.geometry,
      target.destination!.geometry,
      mode,
    );
    expect(saveTransportation).toHaveBeenCalledWith(
      "trip",
      expect.objectContaining({
        mode,
        duration: "PT45M",
        originStayId: "paris",
        destinationStayId: "lyon",
      }),
      true,
    );
    expect(
      await within(screen.getByRole("dialog")).findByText("45m estimated"),
    ).toBeVisible();
    expect(screen.getByTestId("route-preview")).toBeVisible();
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(saveTransportation).toHaveBeenCalledWith(
      "trip",
      expect.objectContaining({
        features: expect.arrayContaining([
          expect.objectContaining({
            id: "road-route",
            geometry: expect.objectContaining({ type: "MultiLineString" }),
          }),
        ]),
      }),
      true,
    );
  },
);
test.each(["flight", "train"])(
  "browsing other tabs and closing the drawer preserves saved %s transportation",
  async (mode) => {
    vi.mocked(listTransportation).mockResolvedValue({
      data: [{ ...value, mode }],
      etag: "",
    });
    show();
    const card = await screen.findByRole("button", { name: /Paris → Lyon/ });
    fireEvent.click(card);
    fireEvent.click(screen.getByRole("tab", { name: "Car" }));
    fireEvent.click(screen.getByRole("tab", { name: "Walking" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Close transportation" }),
    );
    expect(saveTransportation).not.toHaveBeenCalled();
    expect(estimateTransportation).not.toHaveBeenCalled();
    const label = mode === "flight" ? "Flight" : "Train";
    expect(card).toHaveTextContent(label);
    fireEvent.click(card);
    expect(screen.getByRole("tab", { name: label })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  },
);
test("a failed save retains the confirmed transport and permits retry", async () => {
  vi.mocked(listTransportation).mockResolvedValue({ data: [value], etag: "" });
  vi.mocked(saveTransportation).mockRejectedValueOnce(
    new Error("Please retry"),
  );
  show();
  fireEvent.click(await screen.findByRole("button", { name: /Paris → Lyon/ }));
  fireEvent.click(screen.getByRole("tab", { name: "Car" }));
  const save = screen.getByRole("button", { name: "Save" });
  fireEvent.click(save);
  expect(await screen.findByText("Please retry")).toBeVisible();
  expect(screen.getByText("Gare de Lyon → Part Dieu")).toBeVisible();
  fireEvent.click(save);
  await waitFor(() => expect(saveTransportation).toHaveBeenCalledTimes(2));
});
test.each([false, true])(
  "train details are readable offline and edits are grouped (read only: %s)",
  async (readOnly) => {
    vi.mocked(listTransportation).mockResolvedValue({
      data: [value],
      etag: "",
    });
    show(readOnly);
    fireEvent.click(
      await screen.findByRole("button", { name: /Paris → Lyon/ }),
    );
    const form = within(screen.getByRole("dialog"));
    expect(
      form.getByRole("searchbox", { name: "Departure station" }),
    ).toHaveValue("Gare de Lyon");
    const time = form.getByLabelText(/Arrival \(Europe\/Paris\)/);
    expect(time).toHaveValue("2030-04-01T11:00");
    if (readOnly) {
      expect(time).toBeDisabled();
      expect(form.getByRole("button", { name: "Save train" })).toBeDisabled();
    } else {
      fireEvent.change(time, { target: { value: "2030-04-01T12:00" } });
      expect(saveTransportation).not.toHaveBeenCalled();
      fireEvent.click(form.getByRole("button", { name: "Save train" }));
      await waitFor(() =>
        expect(saveTransportation).toHaveBeenCalledWith(
          "trip",
          expect.objectContaining({
            notes: "Bring tickets",
            features: value.features,
            arrivalAt: "2030-04-01T10:00:00.000Z",
          }),
          false,
        ),
      );
    }
  },
);
test.each(["list", "map"])(
  "station search uses shared results and matching numbered %s pins",
  async (selection) => {
    vi.mocked(mapsClient.searchPlaces).mockResolvedValue([
      {
        id: "station",
        name: "Paris Gare de Lyon",
        label: "Paris Gare de Lyon",
        address: "Paris",
        longitude: 2.3,
        latitude: 48.8,
      },
    ]);
    show();
    fireEvent.click(
      await screen.findByRole("button", { name: /Choose transportation/ }),
    );
    fireEvent.click(screen.getByRole("tab", { name: "Train" }));
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Departure station" }),
      { target: { value: "Gare de Lyon" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Search departure station" }),
    );
    const result = await screen.findByRole("button", {
      name: /^1\. Paris Gare de Lyon/,
    });
    expect(mapsClient.searchPlaces).toHaveBeenCalledWith(
      "Gare de Lyon",
      expect.any(AbortSignal),
      stop.destination!.geometry.coordinates,
      "FR",
      { category: "railwayStation" },
    );
    expect(result).toHaveClass("place-search-result-button");
    const pin = screen.getByRole("button", {
      name: "Map result 1. Paris Gare de Lyon",
    });
    fireEvent.click(selection === "list" ? result : pin);
    expect(
      await screen.findByText("Departure station: Paris Gare de Lyon"),
    ).toBeVisible();
    expect(
      screen.getByRole("searchbox", { name: "Departure station" }),
    ).toHaveValue("Paris Gare de Lyon");
    expect(saveTransportation).not.toHaveBeenCalled();
  },
);

test("the whole card is one accessible button and opens both destinations in the drawer", async () => {
  show();
  const card = await screen.findByRole("button", { name: /Paris → Lyon/ });
  expect(card.tagName).toBe("BUTTON");
  expect(card.querySelector("button, a")).toBeNull();
  fireEvent.click(within(card).getByText("Paris → Lyon"));
  const map = within(
    screen.getByRole("img", { name: "Transport map preview" }),
  );
  expect(map.getByText("Paris")).toBeVisible();
  expect(map.getByText("Lyon")).toBeVisible();
  expect(
    screen.getByRole("tablist", { name: "Transportation mode" }),
  ).toBeVisible();
  const tabs = within(
    screen.getByRole("tablist", { name: "Transportation mode" }),
  ).getAllByRole("tab");
  expect(tabs).toHaveLength(5);
  ["Flight", "Train", "Car", "Walking", "Arranged separately"].forEach(
    (label, index) => {
      expect(tabs[index]).toHaveAccessibleName(label);
    },
  );
  expect(tabs.every((tab) => tab.tagName === "BUTTON")).toBe(true);
});

test("Arranged separately uses the shared Save action and stays selected on reopen", async () => {
  show();
  const card = await screen.findByRole("button", {
    name: /Choose transportation/,
  });
  act(() => card.focus());
  fireEvent.click(card);
  const tab = screen.getByRole("tab", { name: "Arranged separately" });
  fireEvent.click(tab);
  expect(tab).toHaveAttribute("aria-selected", "true");
  expect(
    screen.getByRole("tabpanel", { name: "Arranged separately" }),
  ).toBeVisible();
  expect(saveTransportation).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(saveTransportation).toHaveBeenCalledExactlyOnceWith(
      "trip",
      expect.objectContaining({
        mode: "arranged-separately",
        originStayId: "paris",
        destinationStayId: "lyon",
      }),
      true,
    ),
  );
  expect(estimateTransportation).not.toHaveBeenCalled();
  const dismiss = screen.getByRole("button", { name: "Close transportation" });
  await waitFor(() => expect(dismiss).toBeEnabled());
  act(() => dismiss.focus());
  fireEvent.click(dismiss);
  fireEvent.click(
    await screen.findByRole("button", {
      name: /Arranged separately/,
    }),
  );
  expect(
    screen.getByRole("tab", { name: "Arranged separately" }),
  ).toHaveAttribute("aria-selected", "true");
});

test("read-only travelers see the saved Arranged separately tab", async () => {
  vi.mocked(listTransportation).mockResolvedValue({
    data: [{ ...value, mode: "arranged-separately", duration: null }],
    etag: "",
  });
  show(true);
  fireEvent.click(
    await screen.findByRole("button", { name: /Arranged separately/ }),
  );
  expect(
    screen.getByRole("tab", { name: "Arranged separately" }),
  ).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
});

test("flight search stays inside the transportation drawer after selecting flight", async () => {
  show();
  fireEvent.click(await screen.findByRole("button", { name: /Paris → Lyon/ }));
  fireEvent.click(screen.getByRole("tab", { name: "Flight" }));
  expect(
    await screen.findByRole("region", { name: "Flight planning" }),
  ).toBeVisible();
  expect(saveTransportation).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(saveTransportation).toHaveBeenCalledWith(
      "trip",
      expect.objectContaining({ mode: "flight" }),
      true,
    ),
  );
  expect(
    within(screen.getByRole("tabpanel", { name: "Flight" })).getByRole(
      "button",
      {
        name: "Search flights",
      },
    ),
  ).toBeVisible();
  expect(screen.getByRole("tab", { name: "Flight" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("the embedded planner's flight preview reaches the map with its layover and clears when leaving", async () => {
  vi.mocked(listTransportation).mockResolvedValue({
    data: [{ ...value, mode: "flight" }],
    etag: "",
  });
  const points: Record<string, [number, number]> = {
    ATL: [-84.43, 33.64],
    JFK: [-73.78, 40.64],
    LHR: [-0.45, 51.47],
  };
  vi.mocked(searchAirports).mockImplementation(async (code) => [
    {
      id: code,
      code,
      name: code,
      city: code,
      country: "US",
      location: { code, timeZone: "UTC" },
      longitude: points[code][0],
      latitude: points[code][1],
    },
  ]);
  show(true);
  fireEvent.click(await screen.findByRole("button", { name: /Paris → Lyon/ }));
  const card = screen.getByRole("button", {
    name: "Preview connecting flight",
  });
  fireEvent.mouseEnter(card);
  const preview = await screen.findByTestId("route-preview");
  const route = JSON.parse(preview.textContent!);
  expect(route.mode).toBe("flight");
  expect(route.geometry.coordinates).toHaveLength(2);
  expect(route.geometry.coordinates[0].at(-1)).toEqual(points.JFK);
  expect(route.geometry.coordinates[1][0]).toEqual(points.JFK);
  expect(screen.getByText("JFK")).toBeVisible();
  fireEvent.mouseLeave(card);
  expect(screen.queryByTestId("route-preview")).not.toBeInTheDocument();
  expect(
    within(
      screen.getByRole("img", { name: "Transport map preview" }),
    ).getByText("Paris"),
  ).toBeVisible();
  expect(saveTransportation).not.toHaveBeenCalled();
});
