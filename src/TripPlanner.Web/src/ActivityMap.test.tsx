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
import { getMapToken } from "./api";

vi.mock("./api", () => ({ getMapToken: vi.fn() }));

const events = new Map<string, (event: { error?: Error }) => void>();
const createMap = vi.fn();

beforeEach(() => {
  vi.mocked(getMapToken).mockReset();
  createMap.mockReset();
  events.clear();
  class TestMap {
    events = {
      add: (name: string, callback: (event: { error?: Error }) => void) =>
        events.set(name, callback),
    };
    markers = { add: vi.fn(), clear: vi.fn() };
    setCamera = vi.fn();
    dispose = vi.fn();
    resize = vi.fn();
    constructor(container: HTMLElement, options: object) {
      createMap(container, options);
    }
  }
  window.atlas = {
    Map: TestMap,
    HtmlMarker: class {},
  } as unknown as NonNullable<typeof window.atlas>;
});

afterEach(() => {
  delete window.atlas;
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
