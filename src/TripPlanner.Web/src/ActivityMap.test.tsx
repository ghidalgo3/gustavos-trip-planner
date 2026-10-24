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
import type { Activity } from "./activitiesApi";
import { getMapToken } from "./api";

vi.mock("./api", () => ({ getMapToken: vi.fn() }));

const events = new Map<string, (event: { error?: Error }) => void>();
const createMap = vi.fn();
const setStyle = vi.fn();
const setCamera = vi.fn();
const markers: HTMLButtonElement[] = [];

beforeEach(() => {
  vi.mocked(getMapToken).mockReset();
  createMap.mockReset();
  setStyle.mockReset();
  setCamera.mockReset();
  events.clear();
  markers.length = 0;
  class TestMap {
    events = {
      add: (name: string, callback: (event: { error?: Error }) => void) =>
        events.set(name, callback),
    };
    markers = { add: vi.fn(), clear: vi.fn() };
    setCamera = setCamera;
    setStyle = setStyle;
    dispose = vi.fn();
    resize = vi.fn();
    constructor(container: HTMLElement, options: object) {
      createMap(container, options);
    }
  }
  window.atlas = {
    Map: TestMap,
    HtmlMarker: class {
      constructor(options: { htmlContent: HTMLButtonElement }) {
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
  vi.mocked(getMapToken)
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
  expect(getMapToken).toHaveBeenLastCalledWith(undefined, true);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();

  act(() =>
    events.get("error")?.({ error: new Error("Map tile request failed") }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Map tile request failed",
  );
});

test("centers the map on the destination and shows loading until the SDK is ready", async () => {
  vi.mocked(getMapToken).mockResolvedValue({
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
  expect(screen.getByRole("status")).toHaveTextContent("Loading map");
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
  await waitFor(() => expect(createMap).toHaveBeenCalledTimes(2));
  expect(createMap.mock.calls[1][1]).toMatchObject({ center: [12.49, 41.9] });
  expect(screen.getByRole("img", { name: "Map of Rome" })).toBeInTheDocument();
});

test("a map that never becomes ready shows an error instead of an endless blank canvas", async () => {
  vi.mocked(getMapToken).mockResolvedValue({
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
  vi.mocked(getMapToken).mockResolvedValue({
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
        cost: null,
        state: "Proposed",
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
  });
  fireEvent.click(markers[2]);
  expect(onSelect).toHaveBeenCalledWith("stay");
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
    vi.mocked(getMapToken).mockResolvedValue({
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

test("fits all located activities without a hotel, refits new locations, and explains missing pins", async () => {
  vi.mocked(getMapToken).mockResolvedValue({
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
        cost: null,
        state: "Proposed",
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
        cost: null,
        state: "Planned",
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
  });
  expect(screen.getByText("1 of 2 activities located")).toBeVisible();
  expect(
    screen.getByText("1 needs a location to appear on the map."),
  ).toBeVisible();
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
  });
  expect(screen.getByText("2 of 2 activities located")).toBeVisible();
  expect(
    screen.queryByText(/needs a location to appear/),
  ).not.toBeInTheDocument();
  setCamera.mockClear();
  fireEvent.click(screen.getByRole("button", { name: "Show all locations" }));
  expect(setCamera).toHaveBeenCalledWith({
    bounds: [2.3, 48.8, 2.5, 48.9],
    padding: 48,
    maxZoom: 11,
  });
});
