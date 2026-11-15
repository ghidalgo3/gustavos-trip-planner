import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import ActivityMap from "./ActivityMap";
import type { Activity } from "../features/activities/activitiesApi";
import { mapsClient } from "./mapsClient";

vi.spyOn(mapsClient, "getToken");

const events = new Map<string, (event: { error?: Error }) => void>();
const createMap = vi.fn();
const setStyle = vi.fn();
const setCamera = vi.fn();
const markers: HTMLButtonElement[] = [];
const sourceAdd = vi.fn(),
  sourceRemove = vi.fn(),
  layerAdd = vi.fn(),
  layerRemove = vi.fn(),
  routeData = vi.fn(),
  lineOptions = vi.fn();

beforeEach(() => {
  vi.mocked(mapsClient.getToken).mockReset();
  createMap.mockReset();
  setStyle.mockReset();
  setCamera.mockReset();
  [
    sourceAdd,
    sourceRemove,
    layerAdd,
    layerRemove,
    routeData,
    lineOptions,
  ].forEach((mock) => mock.mockReset());
  events.clear();
  markers.length = 0;
  class TestMap {
    events = {
      add: (name: string, callback: (event: { error?: Error }) => void) =>
        events.set(name, callback),
    };
    markers = {
      add: vi.fn(),
      remove: (marker: { button: HTMLButtonElement }) => {
        const index = markers.indexOf(marker.button);
        if (index >= 0) markers.splice(index, 1);
      },
    };
    sources = { add: sourceAdd, remove: sourceRemove };
    layers = { add: layerAdd, remove: layerRemove };
    setCamera = setCamera;
    getCamera = () => ({ center: [2.35, 48.86] as [number, number], zoom: 11 });
    stop = vi.fn();
    setStyle = setStyle;
    dispose = vi.fn();
    resize = vi.fn();
    constructor(container: HTMLElement, options: object) {
      createMap(container, options);
    }
  }
  window.atlas = {
    Map: TestMap,
    source: {
      DataSource: class {
        add = routeData;
      },
    },
    layer: {
      LineLayer: class {
        constructor(_source: object, _id: string | null, options: object) {
          lineOptions(options);
        }
      },
    },
    HtmlMarker: class {
      button: HTMLButtonElement;
      constructor(options: { htmlContent: HTMLButtonElement }) {
        this.button = options.htmlContent;
        markers.push(options.htmlContent);
      }
    },
  } as unknown as NonNullable<typeof window.atlas>;
});

afterEach(() => {
  delete window.atlas;
  vi.unstubAllGlobals();
});

test("shows an expired token error and retries the map", async () => {
  vi.mocked(mapsClient.getToken)
    .mockRejectedValueOnce(
      new Error(
        "Azure Maps token expired. Restart the local development server to renew it.",
      ),
    )
    .mockResolvedValue({
      token: "fresh-sas",
      endpoint: "https://atlas.example.test",
      expiresAt: "2030-01-01T02:00:00Z",
    });

  render(
    <FluentProvider theme={webLightTheme}>
      <ActivityMap
        center={{ type: "Point", coordinates: [2.35, 48.86] }}
        activities={[]}
        onSelect={vi.fn()}
      />
    </FluentProvider>,
  );

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Azure Maps token expired",
  );
  expect(createMap).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Retry map" }));
  await waitFor(() => expect(createMap).toHaveBeenCalledTimes(1));
  expect(mapsClient.getToken).toHaveBeenLastCalledWith(undefined, true);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();

  act(() =>
    events.get("error")?.({ error: new Error("Map tile request failed") }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Map tile request failed",
  );
});

test("centers the map on the destination and shows loading until the SDK is ready", async () => {
  vi.mocked(mapsClient.getToken).mockResolvedValue({
    token: "sas",
    endpoint: "https://atlas.microsoft.com",
    expiresAt: "2030-01-01T02:00:00Z",
  });
  const { rerender } = render(
    <ActivityMap
      center={{ type: "Point", coordinates: [2.35, 48.86] }}
      destinationName="Paris"
      activities={[]}
      onSelect={vi.fn()}
    />,
  );
  expect(screen.getByRole("status", { name: "Loading map" })).toHaveClass(
    "fui-Skeleton",
  );
  expect(document.querySelector(".fui-Spinner")).toBeNull();
  await waitFor(() => expect(createMap).toHaveBeenCalledTimes(1));
  expect(createMap.mock.calls[0][1]).toMatchObject({
    center: [2.35, 48.86],
    zoom: 11,
    authOptions: { authType: "sas", sasToken: "sas" },
  });
  act(() => events.get("ready")?.({}));
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(screen.getByRole("img", { name: "Map of Paris" })).toHaveAttribute(
    "aria-busy",
    "false",
  );
  rerender(
    <ActivityMap
      center={{ type: "Point", coordinates: [12.49, 41.9] }}
      destinationName="Rome"
      activities={[]}
      onSelect={vi.fn()}
    />,
  );
  expect(createMap).toHaveBeenCalledTimes(1);
  expect(setCamera).toHaveBeenLastCalledWith(
    expect.objectContaining({
      bounds: [12.49, 41.9, 12.49, 41.9],
      type: "jump",
      duration: 0,
    }),
  );
  expect(screen.getByRole("img", { name: "Map of Rome" })).toBeInTheDocument();
});

test("camera changes respect reduced motion", async () => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  vi.mocked(mapsClient.getToken).mockResolvedValue({
    token: "sas",
    endpoint: "https://atlas.microsoft.com",
    expiresAt: "2030-01-01T02:00:00Z",
  });
  render(
    <ActivityMap
      center={{ type: "Point", coordinates: [2.35, 48.86] }}
      activities={[]}
      onSelect={vi.fn()}
      placeSearch={{
        results: [{ label: "Garden", longitude: 2.3, latitude: 48.8 }],
        onSelect: vi.fn(),
      }}
    />,
  );
  await waitFor(() => expect(createMap).toHaveBeenCalledTimes(1));
  act(() => events.get("ready")?.({}));
  expect(setCamera).toHaveBeenLastCalledWith(
    expect.objectContaining({ type: "jump", duration: 0 }),
  );
});

test("fullscreen reparents the same map without creating another instance or resetting the camera", async () => {
  vi.mocked(mapsClient.getToken).mockResolvedValue({
    token: "sas",
    endpoint: "https://atlas.microsoft.com",
    expiresAt: "2030-01-01T02:00:00Z",
  });
  const props = {
    center: {
      type: "Point" as const,
      coordinates: [2.35, 48.86] as [number, number],
    },
    activities: [],
    onSelect: vi.fn(),
  };
  const host = document.createElement("div");
  document.body.append(host);
  const { rerender, unmount } = render(<ActivityMap {...props} />);
  await waitFor(() => expect(createMap).toHaveBeenCalledTimes(1));
  act(() => events.get("ready")?.({}));
  const canvas = screen.getByRole("img", { name: "Activity map" });
  const inlineParent = canvas.parentElement?.parentElement;
  rerender(<ActivityMap {...props} portalHost={host} />);
  expect(host).toContainElement(canvas);
  rerender(<ActivityMap {...props} />);
  expect(inlineParent).toContainElement(canvas);
  expect(createMap).toHaveBeenCalledTimes(1);
  expect(mapsClient.getToken).toHaveBeenCalledTimes(1);
  expect(setCamera).not.toHaveBeenCalled();
  unmount();
  host.remove();
});

test("a map that never becomes ready shows an error instead of an endless blank canvas", async () => {
  vi.mocked(mapsClient.getToken).mockResolvedValue({
    token: "sas",
    endpoint: "https://atlas.microsoft.com",
    expiresAt: "2030-01-01T02:00:00Z",
  });
  vi.useFakeTimers();
  try {
    await act(async () => {
      render(
        <ActivityMap
          center={{ type: "Point", coordinates: [2.35, 48.86] }}
          activities={[]}
          onSelect={vi.fn()}
        />,
      );
    });
    expect(createMap).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(20_000));
    expect(screen.getByRole("alert")).toHaveTextContent("taking too long");
    expect(screen.getByRole("button", { name: "Retry map" })).toBeEnabled();
  } finally {
    vi.useRealTimers();
  }
});

test("map bubbles match list positions even when an activity has no location", async () => {
  vi.mocked(mapsClient.getToken).mockResolvedValue({
    token: "sas",
    endpoint: "https://atlas.microsoft.com",
    expiresAt: "2030-01-01T02:00:00Z",
  });
  const activities: Activity[] = ["Museum", "Unlocated", "Park"].map(
    (name, index) => ({
      type: "Feature",
      id: String(index),
      geometry:
        index === 1 ? null : { type: "Point", coordinates: [2.35, 48.86] },
      properties: {
        name,
        duration: null,
        description: "",
        notes: "",
        cost: null,
        kinds: ["Culture" as const],
        address: null,
        ticketRequirement: "Unknown" as const,
        state: "Maybe",
        placeName: null,
      },
    }),
  );
  const onSelect = vi.fn();
  render(
    <ActivityMap
      center={{ type: "Point", coordinates: [2.35, 48.86] }}
      activities={activities}
      selectedId="2"
      stayLocation={{
        type: "Feature",
        id: "stay",
        geometry: { type: "Point", coordinates: [2.34, 48.85] },
        properties: { name: "Paris Hotel" },
      }}
      onSelect={onSelect}
    />,
  );
  await waitFor(() => expect(createMap).toHaveBeenCalledTimes(1));
  act(() => events.get("ready")?.({}));
  expect(markers.map((marker) => marker.textContent)).toEqual(["1", "3", ""]);
  expect(markers[1]).toHaveAccessibleName("Select Park");
  expect(markers[1]).toHaveAttribute("title", "3. Park");
  expect(markers[1]).toHaveAttribute("data-selected", "true");
  fireEvent.click(markers[1]);
  expect(onSelect).toHaveBeenCalledWith("2");
  expect(markers[2]).toHaveAccessibleName("Stay: Paris Hotel");
  expect(markers[2]).toHaveClass("activity-map-stay");
  expect(markers[2].querySelector("svg")).not.toBeNull();
  expect(setCamera).toHaveBeenCalledWith({
    bounds: [2.34, 48.85, 2.35, 48.86],
    padding: 48,
    maxZoom: 11,
    type: "ease",
    duration: 650,
  });
  fireEvent.click(markers[2]);
  expect(onSelect).toHaveBeenCalledWith("stay");
});

test("place search replaces activity and stay bubbles with numbered selectable results, then restores them", async () => {
  vi.mocked(mapsClient.getToken).mockResolvedValue({
    token: "sas",
    endpoint: "https://atlas.microsoft.com",
    expiresAt: "2030-01-01T02:00:00Z",
  });
  const props = {
    center: {
      type: "Point" as const,
      coordinates: [2.35, 48.86] as [number, number],
    },
    activities: [
      {
        type: "Feature",
        id: "museum",
        geometry: { type: "Point", coordinates: [2.35, 48.86] },
        properties: {
          name: "Museum",
          duration: null,
          description: "",
          notes: "",
          cost: null,
          kinds: ["Culture" as const],
          address: null,
          ticketRequirement: "Unknown" as const,
          state: "Maybe",
          placeName: null,
        },
      },
    ] as Activity[],
    stayLocation: {
      type: "Feature" as const,
      id: "stay",
      geometry: {
        type: "Point" as const,
        coordinates: [2.34, 48.85] as [number, number],
      },
      properties: { name: "Hotel" },
    },
    onSelect: vi.fn(),
  };
  const { rerender } = render(<ActivityMap {...props} />);
  await waitFor(() => expect(createMap).toHaveBeenCalledTimes(1));
  act(() => events.get("ready")?.({}));
  expect(markers).toHaveLength(2);
  const onSelect = vi.fn();
  rerender(<ActivityMap {...props} placeSearch={{ results: [], onSelect }} />);
  expect(markers).toHaveLength(0);
  expect(screen.queryByText(/activities located/)).not.toBeInTheDocument();
  rerender(
    <ActivityMap
      {...props}
      placeSearch={{
        results: [
          { label: "Garden", longitude: 2.3, latitude: 48.8 },
          { label: "Cafe", longitude: 2.31, latitude: 48.81 },
        ],
        onSelect,
      }}
    />,
  );
  expect(markers.map((marker) => marker.textContent)).toEqual(["1", "2"]);
  expect(markers[0]).toHaveAttribute("title", "1. Garden");
  expect(markers[1]).toHaveAccessibleName("Select Cafe");
  expect(screen.queryByText("2 search results")).not.toBeInTheDocument();
  expect(setCamera).toHaveBeenLastCalledWith({
    bounds: [2.3, 48.8, 2.31, 48.81],
    padding: 48,
    maxZoom: 11,
    type: "ease",
    duration: 650,
  });
  fireEvent.click(markers[1]);
  expect(onSelect).toHaveBeenCalledWith(1);
  expect(props.onSelect).not.toHaveBeenCalled();
  rerender(<ActivityMap {...props} />);
  expect(markers.map((marker) => marker.getAttribute("aria-label"))).toEqual([
    "Select Museum",
    "Stay: Hotel",
  ]);
});

test.each([false, true])(
  "map uses the system theme and changes it without recreating or moving the map (dark=%s)",
  async (dark) => {
    const listeners = new Set<(event: MediaQueryListEvent) => void>();
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: dark,
        addEventListener: (
          _: string,
          listener: (event: MediaQueryListEvent) => void,
        ) => listeners.add(listener),
        removeEventListener: (
          _: string,
          listener: (event: MediaQueryListEvent) => void,
        ) => listeners.delete(listener),
      })),
    );
    vi.mocked(mapsClient.getToken).mockResolvedValue({
      token: "sas",
      endpoint: "https://atlas.microsoft.com",
      expiresAt: "2030-01-01T02:00:00Z",
    });
    render(
      <ActivityMap
        center={{ type: "Point", coordinates: [2.35, 48.86] }}
        activities={[]}
        onSelect={vi.fn()}
      />,
    );
    await waitFor(() => expect(createMap).toHaveBeenCalledTimes(1));
    expect(createMap.mock.calls[0][1]).toMatchObject({
      style: dark ? "grayscale_dark" : "grayscale_light",
    });
    act(() => events.get("ready")?.({}));
    act(() =>
      listeners.forEach((listener) =>
        listener({ matches: !dark } as MediaQueryListEvent),
      ),
    );
    expect(setStyle).toHaveBeenLastCalledWith({
      style: dark ? "grayscale_light" : "grayscale_dark",
    });
    expect(createMap).toHaveBeenCalledTimes(1);
    expect(setCamera).not.toHaveBeenCalled();
  },
);

test("fits and refits located activities without a floating summary panel", async () => {
  vi.mocked(mapsClient.getToken).mockResolvedValue({
    token: "sas",
    endpoint: "https://atlas.microsoft.com",
    expiresAt: "2030-01-01T02:00:00Z",
  });
  const activities: Activity[] = [
    {
      type: "Feature",
      id: "museum",
      geometry: { type: "Point", coordinates: [2.3, 48.8] },
      properties: {
        name: "Museum",
        duration: null,
        description: "",
        notes: "",
        cost: null,
        kinds: ["Culture" as const],
        address: null,
        ticketRequirement: "Unknown" as const,
        state: "Maybe",
        placeName: null,
      },
    },
    {
      type: "Feature",
      id: "park",
      geometry: null,
      properties: {
        name: "Park",
        duration: null,
        description: "",
        notes: "",
        cost: null,
        kinds: ["Culture" as const],
        address: null,
        ticketRequirement: "Unknown" as const,
        state: "Yes",
        placeName: null,
      },
    },
  ];
  const props = {
    center: {
      type: "Point" as const,
      coordinates: [2.35, 48.86] as [number, number],
    },
    activities,
    onSelect: vi.fn(),
  };
  const { rerender } = render(<ActivityMap {...props} />);
  await waitFor(() => expect(createMap).toHaveBeenCalledTimes(1));
  act(() => events.get("ready")?.({}));
  expect(setCamera).toHaveBeenLastCalledWith({
    bounds: [2.3, 48.8, 2.35, 48.86],
    padding: 48,
    maxZoom: 11,
    type: "ease",
    duration: 650,
  });
  expect(screen.queryByText(/activities located/)).not.toBeInTheDocument();
  expect(
    screen.queryByText(/needs a location to appear/),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Show all locations" }),
  ).not.toBeInTheDocument();
  rerender(
    <ActivityMap {...props} selectedId="museum" activities={[...activities]} />,
  );
  expect(setCamera).toHaveBeenCalledTimes(1);
  const located: Activity[] = [
    activities[0],
    { ...activities[1], geometry: { type: "Point", coordinates: [2.5, 48.9] } },
  ];
  rerender(<ActivityMap {...props} activities={located} />);
  expect(setCamera).toHaveBeenLastCalledWith({
    bounds: [2.3, 48.8, 2.5, 48.9],
    padding: 48,
    maxZoom: 11,
    type: "ease",
    duration: 650,
  });
  expect(screen.queryByText(/activities located/)).not.toBeInTheDocument();
  expect(
    screen.queryByText(/needs a location to appear/),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Show all locations" }),
  ).not.toBeInTheDocument();
});

test("stay preview animates to street level without recreating its map", async () => {
  vi.mocked(mapsClient.getToken).mockResolvedValue({
    token: "sas",
    endpoint: "https://atlas.microsoft.com",
    expiresAt: "2030-01-01T02:00:00Z",
  });
  const center = {
    type: "Point" as const,
    coordinates: [139.69, 35.68] as [number, number],
  };
  const props = { center, activities: [], onSelect: vi.fn() };
  const { rerender } = render(<ActivityMap {...props} />);
  await waitFor(() => expect(createMap).toHaveBeenCalledTimes(1));
  act(() => events.get("ready")?.({}));
  const stay = {
    type: "Feature" as const,
    id: "stay",
    geometry: {
      type: "Point" as const,
      coordinates: [139.7, 35.7] as [number, number],
    },
    properties: { name: "Tokyo Hotel" },
  };
  rerender(
    <ActivityMap
      {...props}
      center={stay.geometry}
      stayLocation={stay}
      zoom={15}
    />,
  );
  await waitFor(() =>
    expect(setCamera).toHaveBeenLastCalledWith(
      expect.objectContaining({
        maxZoom: 15,
        type: "ease",
        duration: 650,
        bounds: [139.7, 35.7, 139.7, 35.7],
      }),
    ),
  );
  expect(createMap).toHaveBeenCalledTimes(1);
  expect(mapsClient.getToken).toHaveBeenCalledTimes(1);
});

test("repeat visits render separate accommodation pins and preserve their selection IDs", async () => {
  vi.mocked(mapsClient.getToken).mockResolvedValue({
    token: "sas",
    endpoint: "https://atlas.microsoft.com",
    expiresAt: "2030-01-01T02:00:00Z",
  });
  const onSelect = vi.fn();
  render(
    <ActivityMap
      center={{ type: "Point", coordinates: [2.35, 48.86] }}
      activities={[]}
      onSelect={onSelect}
      selectedId="stay:second"
      stayLocations={[
        {
          type: "Feature",
          id: "first",
          geometry: { type: "Point", coordinates: [2.34, 48.85] },
          properties: { name: "First hotel" },
        },
        {
          type: "Feature",
          id: "second",
          geometry: { type: "Point", coordinates: [2.4, 48.9] },
          properties: { name: "Second hotel" },
        },
      ]}
    />,
  );
  await waitFor(() => expect(createMap).toHaveBeenCalledTimes(1));
  act(() => events.get("ready")?.({}));
  expect(markers).toHaveLength(2);
  expect(markers[0]).toHaveAccessibleName("Stay: First hotel");
  expect(markers[1]).toHaveAccessibleName("Stay: Second hotel");
  expect(markers[1]).toHaveAttribute("data-selected", "true");
  fireEvent.click(markers[1]);
  expect(onSelect).toHaveBeenCalledWith("stay:second");
});

test("draws the selected street path, frames it, and replaces or clears it without rebuilding the map", async () => {
  vi.mocked(mapsClient.getToken).mockResolvedValue({
    token: "sas",
    endpoint: "https://atlas.microsoft.com",
    expiresAt: "2030-01-01T00:00:00Z",
  });
  const props = {
    center: {
      type: "Point" as const,
      coordinates: [2.35, 48.86] as [number, number],
    },
    activities: [],
    onSelect: vi.fn(),
  };
  const route = {
    mode: "walking",
    geometry: {
      type: "MultiLineString" as const,
      coordinates: [
        [
          [2.3, 48.8],
          [2.32, 48.81],
          [2.4, 48.9],
        ],
      ] as [number, number][][],
    },
  };
  const clear = vi.fn();
  const { rerender } = render(
    <ActivityMap
      {...props}
      route={route}
      routeLabel="Travel from Museum to Garden"
      onClearRoute={clear}
    />,
  );
  await waitFor(() => expect(createMap).toHaveBeenCalledTimes(1));
  act(() => events.get("ready")?.({}));
  await waitFor(() => expect(layerAdd).toHaveBeenCalledTimes(1));
  expect(routeData).toHaveBeenCalledWith(
    expect.objectContaining({ geometry: route.geometry }),
  );
  expect(lineOptions).toHaveBeenCalledWith(
    expect.objectContaining({ strokeDashArray: [2, 2] }),
  );
  expect(setCamera).toHaveBeenLastCalledWith(
    expect.objectContaining({ bounds: [2.3, 48.8, 2.4, 48.9], maxZoom: 16 }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Close route" }));
  expect(clear).toHaveBeenCalledOnce();
  rerender(
    <ActivityMap
      {...props}
      route={{ ...route, mode: "driving" }}
      routeLabel="Travel back to stay"
    />,
  );
  expect(layerRemove).toHaveBeenCalledTimes(1);
  expect(sourceRemove).toHaveBeenCalledTimes(1);
  expect(layerAdd).toHaveBeenCalledTimes(2);
  expect(lineOptions.mock.calls.at(-1)![0]).not.toHaveProperty(
    "strokeDashArray",
  );
  rerender(
    <ActivityMap
      {...props}
      routeLabel="Travel back to stay"
      routeError="Route unavailable. Azure Maps could not return a valid street route between these locations."
    />,
  );
  expect(layerRemove).toHaveBeenCalledTimes(2);
  expect(sourceRemove).toHaveBeenCalledTimes(2);
  expect(layerAdd).toHaveBeenCalledTimes(2);
  expect(screen.getByRole("alert")).toHaveTextContent("Route unavailable");
  rerender(<ActivityMap {...props} />);
  expect(createMap).toHaveBeenCalledTimes(1);
  expect(
    screen.queryByRole("region", { name: "Selected travel route" }),
  ).not.toBeInTheDocument();
});
