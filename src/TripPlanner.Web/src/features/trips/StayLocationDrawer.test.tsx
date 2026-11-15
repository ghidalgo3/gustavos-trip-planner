import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import ColorSchemeProvider from "../../app/ColorSchemeProvider";
import type { PlaceSearch } from "../../maps/ActivityMap";
import {
  saveStayLocation,
  searchStayPlaces,
  type Destination,
} from "../activities/activitiesApi";
import StayLocationDrawer from "./StayLocationDrawer";
vi.mock("../activities/activitiesApi", () => ({
  saveStayLocation: vi.fn(),
  searchStayPlaces: vi.fn(),
}));
vi.mock("../../maps/ActivityMap", () => ({
  default: ({
    stayLocation,
    placeSearch,
  }: {
    stayLocation?: { properties: { name: string } } | null;
    placeSearch?: PlaceSearch;
  }) => (
    <div role="img" aria-label="Stay map preview">
      {stayLocation?.properties.name}
      {placeSearch?.results.map((place, index) =>
        place.longitude !== undefined && place.latitude !== undefined ? (
          <button
            key={index}
            aria-label={`Map result ${index + 1}: ${place.label}`}
            data-coordinates={`${place.longitude},${place.latitude}`}
            onClick={() => placeSearch.onSelect(index)}
          />
        ) : null,
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
    stays: [
      {
        id: "visit",
        order: 0,
        arrivalDate: "2027-06-10",
        departureDate: "2027-06-14",
        arrivalAt: "",
        departureAt: "",
      },
    ],
    isActive: true,
  },
};
const savedDestination: Destination = {
  ...destination,
  properties: {
    ...destination.properties,
    stays: [
      {
        ...destination.properties.stays[0],
        stayLocation: {
          type: "Feature",
          id: "stay",
          geometry: { type: "Point", coordinates: [139.71, 35.71] },
          properties: { name: "Existing Hotel" },
        },
      },
    ],
  },
};
function showDrawer(stayDestination = destination) {
  const onSaved = vi.fn().mockResolvedValue(undefined),
    onClose = vi.fn();
  return {
    ...render(
      <ColorSchemeProvider>
        <StayLocationDrawer
          tripId="trip"
          destination={stayDestination}
          visit={stayDestination.properties.stays[0]}
          onSaved={onSaved}
          onClose={onClose}
        />
      </ColorSchemeProvider>,
    ),
    onSaved,
    onClose,
  };
}

const matches = [
  {
    name: "Hotel Mets Shibuya",
    address: "Shibuya, Tokyo",
    geometry: {
      type: "Point" as const,
      coordinates: [139.703, 35.655] as [number, number],
    },
  },
];
test.each(["list", "map"])(
  "searches Maps only after Search and saves an accommodation from the %s",
  async (source) => {
    vi.mocked(searchStayPlaces).mockResolvedValue(matches);
    vi.mocked(saveStayLocation).mockResolvedValue(undefined);
    const { onSaved } = showDrawer();
    fireEvent.change(screen.getByRole("searchbox", { name: "Stay location" }), {
      target: { value: "Hotel Mets" },
    });
    expect(searchStayPlaces).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    const choice = await screen.findByRole("button", {
      name:
        source === "map"
          ? /^Map result 1: Hotel Mets Shibuya/
          : /^1\. Hotel Mets Shibuya/,
    });
    expect(searchStayPlaces).toHaveBeenCalledWith(
      destination,
      "Hotel Mets",
      expect.any(AbortSignal),
    );
    fireEvent.click(choice);
    await waitFor(() =>
      expect(saveStayLocation).toHaveBeenCalledWith(
        "trip",
        "tokyo-jp",
        "visit",
        expect.objectContaining({
          geometry: matches[0].geometry,
          properties: { name: "Hotel Mets Shibuya", address: "Shibuya, Tokyo" },
        }),
      ),
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    fireEvent.click(choice);
    expect(saveStayLocation).toHaveBeenCalledTimes(1);
  },
);
test("keeps the confirmed hotel visible while Maps search is pending", async () => {
  vi.mocked(searchStayPlaces).mockReturnValue(new Promise(() => {}));
  showDrawer(savedDestination);
  fireEvent.change(screen.getByRole("searchbox", { name: "Stay location" }), {
    target: { value: "Another hotel" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  expect(
    screen.getByRole("img", { name: "Stay map preview" }),
  ).toHaveTextContent("Existing Hotel");
  expect(saveStayLocation).not.toHaveBeenCalled();
});
test("numbers mapped results consistently, disables unlocated results, and clears stale search pins", async () => {
  vi.mocked(searchStayPlaces).mockResolvedValue([
    { name: "Unlocated Hotel", address: "Tokyo", geometry: null },
    ...matches,
  ]);
  showDrawer();
  const search = screen.getByRole("searchbox", { name: "Stay location" });
  fireEvent.change(search, { target: { value: "Hotel" } });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  expect(
    await screen.findByRole("button", { name: /^1\. Unlocated Hotel/ }),
  ).toBeDisabled();
  const pin = await screen.findByRole("button", {
    name: /^Map result 2: Hotel Mets Shibuya/,
  });
  expect(pin).toHaveAttribute("data-coordinates", "139.703,35.655");
  expect(
    screen.queryByRole("button", { name: /^Map result 1:/ }),
  ).not.toBeInTheDocument();
  fireEvent.change(search, { target: { value: "Another hotel" } });
  expect(
    screen.queryByRole("button", { name: /^Map result / }),
  ).not.toBeInTheDocument();
  expect(saveStayLocation).not.toHaveBeenCalled();
});
test("a failed accommodation save preserves the confirmed hotel", async () => {
  vi.mocked(searchStayPlaces).mockResolvedValue(matches);
  vi.mocked(saveStayLocation).mockRejectedValue(
    new Error("Could not save hotel"),
  );
  const { onSaved } = showDrawer(savedDestination);
  fireEvent.change(screen.getByRole("searchbox", { name: "Stay location" }), {
    target: { value: "Hotel Mets" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  fireEvent.click(
    await screen.findByRole("button", { name: /^1\. Hotel Mets Shibuya/ }),
  );
  await screen.findByText("Could not save hotel");
  expect(
    screen.getByRole("img", { name: "Stay map preview" }),
  ).toHaveTextContent("Existing Hotel");
  expect(onSaved).not.toHaveBeenCalled();
});
