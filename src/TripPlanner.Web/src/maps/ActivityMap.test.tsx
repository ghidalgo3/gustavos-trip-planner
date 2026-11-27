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
import { greatCircle } from "./greatCircle";
import type { Activity } from "../features/activities/activitiesApi";
import { mapsClient } from "./mapsClient";
import { calendarActivities } from "../test/activityCalendarFixture";

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
  routeShapes = vi.fn(),
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
    routeShapes,
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
        setShapes = routeShapes;
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
        properties: {
          name: "Paris Hotel",
          checkInTime: "16:00:00",
          checkOutTime: "11:00:00",
        },
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
      properties: {
        name: "Hotel",
        checkInTime: "16:00:00",
        checkOutTime: "11:00:00",
      },
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

test("Ideas draws solid pins for any assigned day and dashed pins for unassigned activities", async () => {
  vi.mocked(mapsClient.getToken).mockResolvedValue({
    token: "sas",
    endpoint: "https://atlas.microsoft.com",
    expiresAt: "2030-01-01T02:00:00Z",
  });
  const [museum, garden, cafe] = calendarActivities;
  render(
    <ActivityMap
      center={museum.geometry!}
      activities={[museum, garden, cafe]}
      ideasScheduledActivityIds={[museum.id, garden.id]}
      onSelect={vi.fn()}
    />,
  );
  await waitFor(() => expect(createMap).toHaveBeenCalledOnce());
  act(() => events.get("ready")?.({}));

  expect(markers.map((marker) => marker.textContent)).toEqual(["1", "2", "3"]);
  expect(markers[0]).toHaveClass("activity-map-scheduled");
  expect(markers[1]).toHaveClass("activity-map-scheduled");
  expect(markers[2]).toHaveClass("activity-map-unscheduled");
  expect(layerAdd).not.toHaveBeenCalled();
  const legend = screen.getByText("Map legend");
  expect(legend.closest("details")).not.toHaveAttribute("open");
  fireEvent.click(legend);
  expect(screen.getByText("Scheduled")).toBeVisible();
  expect(screen.getByText("No day assigned")).toBeVisible();
  expect(screen.queryByText("Other days")).not.toBeInTheDocument();
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
    properties: {
      name: "Tokyo Hotel",
      checkInTime: "16:00:00",
      checkOutTime: "11:00:00",
    },
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
          properties: {
            name: "First hotel",
            checkInTime: "16:00:00",
            checkOutTime: "11:00:00",
          },
        },
        {
          type: "Feature",
          id: "second",
          geometry: { type: "Point", coordinates: [2.4, 48.9] },
          properties: {
            name: "Second hotel",
            checkInTime: "16:00:00",
            checkOutTime: "11:00:00",
          },
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

test.each([false, true])(
  "styles all Schedule pins and connects the selected day in time order (%s)",
  async (reducedMotion) => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      frames.push(callback),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("prefers-reduced-motion") && reducedMotion,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    vi.mocked(mapsClient.getToken).mockResolvedValue({
      token: "sas",
      endpoint: "https://atlas.microsoft.com",
      expiresAt: "2030-01-01T02:00:00Z",
    });
    const [museum, garden, cafe] = calendarActivities;
    const onSelect = vi.fn();
    const props = {
      center: museum.geometry!,
      activities: [
        garden,
        museum,
        { ...cafe, geometry: null },
        { ...cafe, id: "fourth" },
        { ...cafe, id: "fifth" },
      ],
      onSelect,
    };
    const schedule = {
      activeActivityIds: [museum.id, garden.id, cafe.id],
      scheduledActivityIds: [museum.id, garden.id, cafe.id, "fourth"],
    };
    const { rerender } = render(<ActivityMap {...props} schedule={schedule} />);
    await waitFor(() => expect(createMap).toHaveBeenCalledOnce());
    const startedAt = performance.now();
    act(() => events.get("ready")?.({}));
    expect(markers.map((marker) => marker.title)).toEqual([
      "1. Garden",
      "2. Museum",
      "4. Cafe",
      "5. Cafe",
    ]);
    expect(markers[0]).toHaveClass("activity-map-active-day");
    expect(markers[0]).toHaveAttribute("data-calendar-activity-id", garden.id);
    expect(markers[1]).toHaveClass("activity-map-active-day");
    expect(markers[2]).toHaveClass("activity-map-other-day");
    expect(markers[3]).toHaveClass("activity-map-unscheduled");
    fireEvent.click(markers[0]);
    expect(onSelect).toHaveBeenCalledWith(garden.id);
    const legend = screen.getByText("Map legend");
    expect(legend.closest("details")).not.toHaveAttribute("open");
    fireEvent.click(legend);
    expect(screen.getByText("No day assigned")).toBeVisible();
    const geometry = routeData.mock.calls[0][0].geometry;
    expect(geometry.type).toBe("MultiLineString");
    expect(geometry.coordinates).toHaveLength(1);
    expect(geometry.coordinates[0][0]).toEqual(museum.geometry!.coordinates);
    expect(geometry.coordinates[0].at(-1)).toEqual(
      garden.geometry!.coordinates,
    );
    if (reducedMotion) {
      expect(layerAdd).toHaveBeenCalledOnce();
      expect(routeShapes).not.toHaveBeenCalled();
    } else {
      expect(layerAdd).toHaveBeenCalledTimes(2);
      for (const elapsed of [200, 400, 600]) {
        const pending = frames.splice(0);
        act(() => pending.forEach((frame) => frame(startedAt + elapsed)));
      }
      expect(routeShapes).toHaveBeenCalledTimes(3);
      expect(routeShapes.mock.calls[0]).not.toEqual(routeShapes.mock.calls[2]);
    }
    rerender(
      <ActivityMap
        {...props}
        schedule={{ ...schedule, activeActivityIds: ["fourth"] }}
      />,
    );
    expect(markers.map((marker) => marker.textContent)).toEqual([
      "1",
      "2",
      "4",
      "5",
    ]);
    expect(markers[0]).toHaveClass("activity-map-other-day");
    expect(markers[2]).toHaveClass("activity-map-active-day");
    expect(markers[3]).toHaveClass("activity-map-unscheduled");
    expect(layerRemove).toHaveBeenCalledTimes(reducedMotion ? 1 : 2);
    expect(sourceRemove).toHaveBeenCalledTimes(reducedMotion ? 1 : 2);
    expect(createMap).toHaveBeenCalledOnce();
  },
);

test.each(["preview", "saved leg"] as const)(
  "animation follows the street corner for a %s",
  async (source) => {
    vi.mocked(mapsClient.getToken).mockResolvedValue({
      token: "sas",
      endpoint: "https://atlas.microsoft.com",
      expiresAt: "2030-01-01T00:00:00Z",
    });
    const [museum, garden] = calendarActivities;
    const corner: [number, number] = [museum.geometry!.coordinates[0], 48.81];
    const route = {
      mode: "walking",
      geometry: {
        type: "MultiLineString" as const,
        coordinates: [
          [
            museum.geometry!.coordinates,
            corner,
            [garden.geometry!.coordinates[0], corner[1]],
          ] as [number, number][],
        ],
      },
    };
    const start = vi.spyOn(performance, "now").mockReturnValue(0);
    const callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      callbacks.push(callback),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    render(
      <ActivityMap
        center={museum.geometry!}
        activities={[museum, garden]}
        onSelect={vi.fn()}
        {...(source === "preview"
          ? { route, animateRoute: true }
          : {
              schedule: {
                activeActivityIds: [museum.id, garden.id],
                scheduledActivityIds: [museum.id, garden.id],
                routes: new Map([[museum.id + ":" + garden.id, route]]),
              },
            })}
      />,
    );
    await waitFor(() => expect(createMap).toHaveBeenCalledOnce());
    act(() => events.get("ready")?.({}));
    expect(routeData).toHaveBeenCalledWith(
      expect.objectContaining({ geometry: route.geometry }),
    );
    for (const time of [800, 1500, 2100]) {
      const pending = callbacks.splice(0);
      pending.forEach((callback) => callback(time));
    }
    const points = routeShapes.mock.calls.flatMap(([features]) =>
      features.flatMap(({ geometry }: { geometry: typeof route.geometry }) =>
        geometry.coordinates.flat(),
      ),
    );
    expect(points.length).toBeGreaterThan(0);
    for (const [longitude, latitude] of points) {
      expect(
        Math.abs(longitude - corner[0]) < 1e-8 ||
          Math.abs(latitude - corner[1]) < 1e-8,
      ).toBe(true);
    }
    start.mockRestore();
  },
);

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

test("transport landmarks frame both destinations and remain visible while numbered search pins select stations", async () => {
  vi.mocked(mapsClient.getToken).mockResolvedValue({
    token: "sas",
    endpoint: "https://atlas.microsoft.com",
    expiresAt: "2030-01-01T02:00:00Z",
  });
  const landmarks = [
    {
      id: "from",
      label: "Paris",
      pin: "A",
      geometry: {
        type: "Point" as const,
        coordinates: [2.35, 48.86] as [number, number],
      },
    },
    {
      id: "to",
      label: "Lyon",
      pin: "B",
      geometry: {
        type: "Point" as const,
        coordinates: [4.83, 45.76] as [number, number],
      },
    },
  ];
  const onSelect = vi.fn();
  const props = {
    center: landmarks[0].geometry,
    activities: [],
    landmarks,
    onSelect: vi.fn(),
  };
  const { rerender } = render(<ActivityMap {...props} />);
  await waitFor(() => expect(createMap).toHaveBeenCalledOnce());
  act(() => events.get("ready")?.({}));
  await waitFor(() => expect(markers).toHaveLength(2));
  expect(markers.map((marker) => marker.getAttribute("aria-label"))).toEqual([
    "Paris",
    "Lyon",
  ]);
  expect(setCamera).toHaveBeenLastCalledWith(
    expect.objectContaining({ bounds: [2.35, 45.76, 4.83, 48.86] }),
  );
  rerender(
    <ActivityMap
      {...props}
      placeSearch={{
        results: [{ label: "Gare de Lyon", longitude: 2.37, latitude: 48.84 }],
        onSelect,
      }}
    />,
  );
  const station = markers.find(
    (marker) => marker.getAttribute("aria-label") === "Select Gare de Lyon",
  )!;
  expect(station.textContent).toBe("1");
  fireEvent.click(station);
  expect(onSelect).toHaveBeenCalledWith(0);
  expect(
    markers.filter((marker) =>
      ["Paris", "Lyon"].includes(marker.getAttribute("aria-label")!),
    ),
  ).toHaveLength(2);
});

test.each([
  {
    name: "Pacific dateline crossing",
    hops: [
      [140.39, 35.77],
      [-122.31, 47.45],
    ],
    width: 800,
    height: 400,
  },
  {
    name: "transatlantic connection in a shallow drawer map",
    hops: [
      [-84.4277, 33.6407],
      [-73.778, 40.641],
      [-0.4543, 51.47],
    ],
    width: 1056,
    height: 260,
  },
  {
    name: "short flight on mobile",
    hops: [
      [-0.4543, 51.47],
      [4.7639, 52.3086],
    ],
    width: 366,
    height: 200,
  },
])(
  "flight arcs tightly frame every hop: $name",
  async ({ hops, width, height }) => {
    vi.mocked(mapsClient.getToken).mockResolvedValue({
      token: "sas",
      endpoint: "https://atlas.microsoft.com",
      expiresAt: "2030-01-01T02:00:00Z",
    });
    const airports = hops as [number, number][];
    const origin = airports[0];
    const route = {
      mode: "flight",
      geometry: {
        type: "MultiLineString" as const,
        coordinates: airports
          .slice(1)
          .flatMap((to, index) => greatCircle(airports[index], to)),
      },
    };
    const props = {
      center: { type: "Point" as const, coordinates: origin },
      activities: [],
      onSelect: vi.fn(),
    };
    const { rerender } = render(
      <ActivityMap {...props} route={route} routeLabel="NRT → SEA" />,
    );
    Object.defineProperties(screen.getByRole("img", { name: "Activity map" }), {
      clientWidth: { value: width, configurable: true },
      clientHeight: { value: height, configurable: true },
    });
    await waitFor(() => expect(createMap).toHaveBeenCalledOnce());
    act(() => events.get("ready")?.({}));
    await waitFor(() => expect(layerAdd).toHaveBeenCalledOnce());
    expect(routeData).toHaveBeenCalledWith(
      expect.objectContaining({ geometry: route.geometry }),
    );
    const frame = setCamera.mock.calls.at(-1)![0];
    // Azure dispatches to bounds fitting if padding or offset is present, even
    // with center/zoom. Without explicit bounds that means the whole world.
    expect(frame).not.toHaveProperty("bounds");
    expect(frame).not.toHaveProperty("padding");
    expect(frame).not.toHaveProperty("offset");
    expect(frame.zoom).toBeGreaterThan(1);
    const mercatorY = (latitude: number) =>
      (1 - Math.asinh(Math.tan((latitude * Math.PI) / 180)) / Math.PI) / 2;
    const scale = 512 * 2 ** frame.zoom;
    const offsets = route.geometry.coordinates
      .flat()
      .map(([longitude, latitude]) => [
        Math.abs((((longitude - frame.center[0] + 540) % 360) - 180) / 360) *
          scale,
        Math.abs(mercatorY(latitude) - mercatorY(frame.center[1])) * scale,
      ]);
    const horizontal = Math.max(...offsets.map(([x]) => x));
    const vertical = Math.max(...offsets.map(([, y]) => y));
    expect(horizontal).toBeLessThanOrEqual(width / 2 - 48 + 0.01);
    expect(vertical).toBeLessThanOrEqual(height / 2 - 48 + 0.01);
    // At least one dimension reaches the padded edge: no unnecessary zoom-out.
    expect(
      Math.max(horizontal / (width / 2 - 48), vertical / (height / 2 - 48)),
    ).toBeCloseTo(1, 6);
    expect(screen.getByText("Illustrative flight path")).toBeVisible();
    expect(screen.queryByText("Driving route")).not.toBeInTheDocument();
    rerender(<ActivityMap {...props} />);
    expect(layerRemove).toHaveBeenCalledOnce();
    expect(sourceRemove).toHaveBeenCalledOnce();
  },
);
