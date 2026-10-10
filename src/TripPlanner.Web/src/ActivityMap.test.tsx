import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    constructor() {
      createMap();
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
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();

  events.get("error")?.({ error: new Error("Map tile request failed") });
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Map tile request failed",
  );
});
