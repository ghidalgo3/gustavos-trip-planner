import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import ColorSchemeProvider from "../../app/ColorSchemeProvider";
import StayLocationDrawer from "./StayLocationDrawer";
import { searchPlaces } from "../../api/api";
import {
  saveStayLocation,
  researchStayAddress,
  type Destination,
} from "../activities/activitiesApi";
vi.mock("../../api/api", () => ({ searchPlaces: vi.fn() }));
vi.mock("../activities/activitiesApi", () => ({
  saveStayLocation: vi.fn(),
  researchStayAddress: vi.fn(),
}));
vi.mock("../../maps/ActivityMap", () => ({
  default: ({
    center,
    stayLocation,
    zoom,
    onPick,
  }: {
    center: { coordinates: number[] };
    stayLocation?: {
      properties: { name: string };
      geometry: { coordinates: number[] };
    } | null;
    zoom?: number;
    onPick?: (point: { type: "Point"; coordinates: [number, number] }) => void;
  }) => (
    <div
      role="img"
      aria-label="Stay map preview"
      data-center={JSON.stringify(center.coordinates)}
      data-zoom={zoom}
    >
      {stayLocation && (
        <span>{`Stay pin: ${stayLocation.properties.name}`}</span>
      )}
      {onPick && (
        <button
          onClick={() =>
            onPick({ type: "Point", coordinates: [139.703, 35.655] })
          }
        >
          Pick map location
        </button>
      )}
    </div>
  ),
}));
beforeEach(() => vi.resetAllMocks());
const destination: Destination = {
  type: "Feature",
  id: "tokyo-jp",
  geometry: { type: "Point", coordinates: [139.69, 35.68] },
  properties: {
    name: "Tokyo",
    countryCode: "JP",
    timeZone: null,
    contextVersion: "1",
    arrivalDate: null,
    departureDate: null,
    stays: [],
    isActive: true,
  },
};
test("Stay lookup is near the destination and saves only the chosen location", async () => {
  vi.mocked(searchPlaces).mockResolvedValue([
    {
      id: "hotel",
      name: "Tokyo Hotel",
      label: "Tokyo Hotel, Shinjuku",
      address: "Shinjuku",
      longitude: 139.7,
      latitude: 35.7,
    },
  ]);
  vi.mocked(saveStayLocation).mockResolvedValue();
  const onSaved = vi.fn().mockResolvedValue(undefined),
    onClose = vi.fn();
  render(
    <ColorSchemeProvider>
      <StayLocationDrawer
        tripId="trip"
        destination={destination}
        onSaved={onSaved}
        onClose={onClose}
      />
    </ColorSchemeProvider>,
  );
  expect(screen.getByRole("button", { name: "Save Stay" })).toBeDisabled();
  fireEvent.change(screen.getByRole("combobox", { name: "Stay location" }), {
    target: { value: "Tokyo Hotel" },
  });
  const result = await screen.findByRole("option", {
    name: "Tokyo Hotel, Shinjuku",
  });
  expect(within(result).getByText("Tokyo Hotel")).toBeVisible();
  expect(within(result).getByText("Shinjuku")).toHaveClass(
    "place-search-result-address",
  );
  fireEvent.click(result);
  expect(searchPlaces).toHaveBeenCalledWith(
    "Tokyo Hotel",
    expect.any(AbortSignal),
    [139.69, 35.68],
    "JP",
    { typeahead: true },
  );
  expect(screen.getByRole("img", { name: "Stay map preview" })).toHaveAttribute(
    "data-center",
    "[139.7,35.7]",
  );
  expect(screen.getByRole("img", { name: "Stay map preview" })).toHaveAttribute(
    "data-zoom",
    "15",
  );
  expect(screen.getByText("Stay pin: Tokyo Hotel")).toBeVisible();
  expect(saveStayLocation).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Save Stay" }));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect(saveStayLocation).toHaveBeenCalledWith("trip", "tokyo-jp", {
    type: "Feature",
    id: "stay",
    geometry: { type: "Point", coordinates: [139.7, 35.7] },
    properties: { name: "Tokyo Hotel" },
  });
  expect(onSaved).toHaveBeenCalled();
});

test("editing a hotel search clears its pin and prevents saving stale coordinates", async () => {
  const saved: Destination = {
    ...destination,
    properties: {
      ...destination.properties,
      stayLocation: {
        type: "Feature",
        id: "stay",
        geometry: { type: "Point", coordinates: [139.7, 35.7] },
        properties: { name: "Tokyo Hotel" },
      },
    },
  };
  vi.mocked(searchPlaces).mockResolvedValue([
    {
      id: "other",
      name: "Other Hotel",
      label: "Other Hotel, Tokyo",
      longitude: 139.75,
      latitude: 35.65,
    },
  ]);
  render(
    <ColorSchemeProvider>
      <StayLocationDrawer
        tripId="trip"
        destination={saved}
        onSaved={vi.fn()}
        onClose={vi.fn()}
      />
    </ColorSchemeProvider>,
  );
  const map = screen.getByRole("img", { name: "Stay map preview" });
  expect(screen.getByText("Stay pin: Tokyo Hotel")).toBeVisible();
  expect(searchPlaces).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole("combobox", { name: "Stay location" }), {
    target: { value: "Othr Hot" },
  });
  expect(screen.queryByText("Stay pin: Tokyo Hotel")).toBeNull();
  expect(screen.getByRole("button", { name: "Save Stay" })).toBeDisabled();
  expect(screen.getByRole("img", { name: "Stay map preview" })).toBe(map);
  expect(map).toHaveAttribute("data-center", "[139.69,35.68]");
  fireEvent.click(
    await screen.findByRole("option", { name: "Other Hotel, Tokyo" }),
  );
  expect(map).toHaveAttribute("data-center", "[139.75,35.65]");
  expect(screen.getByRole("button", { name: "Save Stay" })).toBeEnabled();
  expect(saveStayLocation).not.toHaveBeenCalled();
});

test("Search Address researches a sourced address and requires Save Stay to accept the map pin", async () => {
  vi.mocked(researchStayAddress).mockResolvedValue({
    name: "JR-East Hotel Mets Shibuya",
    address: "3-29-17 Shibuya, Tokyo",
    source: {
      url: "https://www.hotelmets.jp/en/shibuya/access.html",
      label: "Venue source",
    },
    geometry: { type: "Point", coordinates: [139.703, 35.655] },
    warning: null,
  });
  vi.mocked(searchPlaces).mockImplementation(() => new Promise(() => {}));
  vi.mocked(saveStayLocation).mockResolvedValue();
  const onSaved = vi.fn().mockResolvedValue(undefined);
  render(
    <ColorSchemeProvider>
      <StayLocationDrawer
        tripId="trip"
        destination={destination}
        onSaved={onSaved}
        onClose={vi.fn()}
      />
    </ColorSchemeProvider>,
  );
  fireEvent.change(screen.getByRole("combobox", { name: "Stay location" }), {
    target: { value: "JR-East Hotel Mets Shibuya" },
  });
  expect(
    await screen.findByRole("status", { name: "Searching Stay location" }),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Search Address" }));
  expect(
    await screen.findByText("Stay pin: JR-East Hotel Mets Shibuya"),
  ).toBeVisible();
  expect(screen.getByText("3-29-17 Shibuya, Tokyo")).toBeVisible();
  expect(screen.getByRole("link", { name: "Venue source" })).toHaveAttribute(
    "href",
    "https://www.hotelmets.jp/en/shibuya/access.html",
  );
  expect(researchStayAddress).toHaveBeenCalledWith(
    "trip",
    "tokyo-jp",
    "JR-East Hotel Mets Shibuya",
    expect.any(AbortSignal),
  );
  expect(screen.queryByRole("button", { name: "Choose on map" })).toBeNull();
  expect(screen.getByRole("img", { name: "Stay map preview" })).toHaveAttribute(
    "data-center",
    "[139.703,35.655]",
  );
  expect(
    screen.queryByRole("status", { name: "Searching Stay location" }),
  ).toBeNull();
  expect(saveStayLocation).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Save Stay" }));
  await waitFor(() =>
    expect(saveStayLocation).toHaveBeenCalledWith("trip", "tokyo-jp", {
      type: "Feature",
      id: "stay",
      geometry: { type: "Point", coordinates: [139.703, 35.655] },
      properties: { name: "JR-East Hotel Mets Shibuya" },
    }),
  );
});

test.each(["unresolved", "missing", "failed"])(
  "address search %s clears stale coordinates and does not save",
  async (scenario) => {
    vi.mocked(searchPlaces).mockResolvedValue([]);
    const warning =
      "Address found, but its map location could not be confirmed.";
    if (scenario === "failed")
      vi.mocked(researchStayAddress).mockRejectedValue(
        new Error("Address search unavailable"),
      );
    else
      vi.mocked(researchStayAddress).mockResolvedValue(
        scenario === "missing"
          ? null
          : {
              name: "Hotel",
              address: "A sourced street address",
              source: {
                url: "https://hotel.example/address",
                label: "Venue source",
              },
              geometry: null,
              warning,
            },
      );
    render(
      <ColorSchemeProvider>
        <StayLocationDrawer
          tripId="trip"
          destination={{
            ...destination,
            properties: {
              ...destination.properties,
              stayLocation: {
                type: "Feature",
                id: "stay",
                geometry: { type: "Point", coordinates: [139.7, 35.7] },
                properties: { name: "Hotel" },
              },
            },
          }}
          onSaved={vi.fn()}
          onClose={vi.fn()}
        />
      </ColorSchemeProvider>,
    );
    expect(screen.getByRole("button", { name: "Save Stay" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Search Address" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Search Address" }),
      ).toBeEnabled(),
    );
    expect(screen.getByRole("button", { name: "Save Stay" })).toBeDisabled();
    expect(screen.queryByText("Stay pin: Hotel")).toBeNull();
    expect(saveStayLocation).not.toHaveBeenCalled();
    if (scenario === "unresolved") {
      expect(screen.getByText(warning)).toBeVisible();
      expect(screen.getByText("A sourced street address")).toBeVisible();
    } else
      expect(
        await screen.findByText(
          scenario === "failed"
            ? "Address search unavailable"
            : "No confirmed address found. Try a more specific hotel name or address.",
        ),
      ).toBeVisible();
  },
);

test("address research shows a skeleton, locks selection, and aborts when the drawer closes", async () => {
  vi.mocked(searchPlaces).mockResolvedValue([]);
  vi.mocked(researchStayAddress).mockImplementation(
    () => new Promise(() => {}),
  );
  const { unmount } = render(
    <ColorSchemeProvider>
      <StayLocationDrawer
        tripId="trip"
        destination={destination}
        onSaved={vi.fn()}
        onClose={vi.fn()}
      />
    </ColorSchemeProvider>,
  );
  fireEvent.change(screen.getByRole("combobox", { name: "Stay location" }), {
    target: { value: "Hotel Mets" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Search Address" }));
  expect(
    screen.getByRole("status", { name: "Searching stay address" }),
  ).toBeVisible();
  expect(
    screen.getByRole("combobox", { name: "Stay location" }),
  ).toBeDisabled();
  expect(screen.getByRole("button", { name: "Save Stay" })).toBeDisabled();
  const signal = vi.mocked(researchStayAddress).mock.calls[0][3]!;
  unmount();
  expect(signal.aborted).toBe(true);
});
