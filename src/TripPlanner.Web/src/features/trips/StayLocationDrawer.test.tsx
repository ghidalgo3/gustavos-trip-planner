import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import ColorSchemeProvider from "../../app/ColorSchemeProvider";
import StayLocationDrawer from "./StayLocationDrawer";
import { searchPlaces } from "../../api/api";
import {
  saveStayLocation,
  researchStayAddress,
  type Destination,
  type StayAddressSuggestion,
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
  }: {
    center: { coordinates: number[] };
    stayLocation?: {
      properties: { name: string };
      geometry: { coordinates: number[] };
    } | null;
    zoom?: number;
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
const matches: StayAddressSuggestion[] = [
  {
    name: "Hotel Mets Shibuya",
    address: "3-29-17 Shibuya, Tokyo",
    source: {
      url: "https://www.hotelmets.jp/en/shibuya/access.html",
      label: "Hotel website",
    },
    geometry: { type: "Point", coordinates: [139.703, 35.655] },
    warning: null,
  },
  {
    name: "Hotel Mets Shinjuku",
    address: "1 Main Street, Shinjuku, Tokyo",
    source: { url: "https://hotel.example/shinjuku", label: "Hotel website" },
    geometry: { type: "Point", coordinates: [139.7, 35.69] },
    warning: null,
  },
];
const savedDestination: Destination = {
  ...destination,
  properties: {
    ...destination.properties,
    stayLocation: {
      type: "Feature",
      id: "stay",
      geometry: { type: "Point", coordinates: [139.71, 35.71] },
      properties: { name: "Existing Hotel" },
    },
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
          onSaved={onSaved}
          onClose={onClose}
        />
      </ColorSchemeProvider>,
    ),
    onSaved,
    onClose,
  };
}
function typeQuery(query = "Hotel Mets") {
  fireEvent.change(screen.getByRole("textbox", { name: "Stay location" }), {
    target: { value: query },
  });
}

test("typing makes no search requests; explicit search returns choices and saves only the selected stay", async () => {
  vi.mocked(researchStayAddress).mockResolvedValue(matches);
  vi.mocked(saveStayLocation).mockResolvedValue();
  const { onSaved, onClose } = showDrawer();
  expect(screen.getByRole("button", { name: "Search" })).toBeDisabled();
  typeQuery();
  await new Promise((resolve) => setTimeout(resolve, 350));
  expect(searchPlaces).not.toHaveBeenCalled();
  expect(researchStayAddress).not.toHaveBeenCalled();
  expect(screen.queryByRole("combobox")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  const choices = await screen.findAllByRole("radio");
  expect(choices).toHaveLength(2);
  expect(choices.every((choice) => !(choice as HTMLInputElement).checked)).toBe(
    true,
  );
  expect(screen.getByText(matches[0].address)).toHaveClass(
    "place-search-result-address",
  );
  expect(
    screen.getByRole("link", { name: "Source for Hotel Mets Shibuya" }),
  ).toHaveAttribute("href", matches[0].source.url);
  expect(researchStayAddress).toHaveBeenCalledWith(
    "trip",
    "tokyo-jp",
    "Hotel Mets",
    expect.any(AbortSignal),
  );
  expect(searchPlaces).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Save Stay" })).toBeDisabled();
  fireEvent.click(choices[1]);
  expect(screen.getByText("Stay pin: Hotel Mets Shinjuku")).toBeVisible();
  expect(screen.getByRole("img", { name: "Stay map preview" })).toHaveAttribute(
    "data-center",
    "[139.7,35.69]",
  );
  expect(screen.getByRole("img", { name: "Stay map preview" })).toHaveAttribute(
    "data-zoom",
    "15",
  );
  expect(saveStayLocation).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Save Stay" }));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect(saveStayLocation).toHaveBeenCalledWith("trip", "tokyo-jp", {
    type: "Feature",
    id: "stay",
    geometry: matches[1].geometry,
    properties: { name: matches[1].name },
  });
  expect(onSaved).toHaveBeenCalled();
});

test("Enter submits the search form and even a single result requires explicit selection", async () => {
  vi.mocked(researchStayAddress).mockResolvedValue([matches[0]]);
  showDrawer();
  typeQuery("JR-East Hotel Mets Shibuya");
  fireEvent.submit(
    screen.getByRole("textbox", { name: "Stay location" }).closest("form")!,
  );
  const choice = await screen.findByRole("radio");
  expect(choice).not.toBeChecked();
  expect(screen.getByRole("button", { name: "Save Stay" })).toBeDisabled();
  fireEvent.click(choice);
  expect(screen.getByRole("button", { name: "Save Stay" })).toBeEnabled();
  expect(saveStayLocation).not.toHaveBeenCalled();
});

test("editing the query clears the draft pin and old results while preserving the map", async () => {
  vi.mocked(researchStayAddress).mockResolvedValue(matches);
  showDrawer(savedDestination);
  const map = screen.getByRole("img", { name: "Stay map preview" });
  expect(screen.getByText("Stay pin: Existing Hotel")).toBeVisible();
  expect(screen.getByRole("button", { name: "Save Stay" })).toBeEnabled();
  typeQuery();
  expect(screen.queryByText("Stay pin: Existing Hotel")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  fireEvent.click((await screen.findAllByRole("radio"))[0]);
  typeQuery("Another Hotel");
  expect(screen.queryAllByRole("radio")).toHaveLength(0);
  expect(screen.queryByText("Stay pin: Hotel Mets Shibuya")).toBeNull();
  expect(screen.getByRole("button", { name: "Save Stay" })).toBeDisabled();
  expect(screen.getByRole("img", { name: "Stay map preview" })).toBe(map);
  expect(map).toHaveAttribute("data-center", "[139.69,35.68]");
  expect(researchStayAddress).toHaveBeenCalledTimes(1);
  expect(saveStayLocation).not.toHaveBeenCalled();
});

test.each(["unresolved", "missing", "failed"])(
  "search %s cannot reuse a stale pin or save an unlocated result",
  async (scenario) => {
    const warning =
      "Address found, but its map location could not be confirmed.";
    if (scenario === "failed")
      vi.mocked(researchStayAddress).mockRejectedValue(
        new Error("Search unavailable"),
      );
    else
      vi.mocked(researchStayAddress).mockResolvedValue(
        scenario === "missing"
          ? []
          : [{ ...matches[0], geometry: null, warning }],
      );
    showDrawer(savedDestination);
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Search" })).toBeEnabled(),
    );
    expect(screen.getByRole("button", { name: "Save Stay" })).toBeDisabled();
    expect(screen.queryByText("Stay pin: Existing Hotel")).toBeNull();
    expect(saveStayLocation).not.toHaveBeenCalled();
    if (scenario === "unresolved") {
      expect(screen.getByRole("radio")).toBeDisabled();
      expect(screen.getByText(warning)).toBeVisible();
      expect(screen.getByText(matches[0].address)).toBeVisible();
    } else
      expect(
        await screen.findByText(
          scenario === "failed"
            ? "Search unavailable"
            : "No matching stays found. Try a more specific hotel name or address.",
        ),
      ).toBeVisible();
  },
);

test("search shows skeletons, locks the field, and aborts when the drawer closes", () => {
  vi.mocked(researchStayAddress).mockImplementation(
    () => new Promise(() => {}),
  );
  const { unmount } = showDrawer();
  typeQuery();
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  expect(screen.getByRole("status", { name: "Searching stays" })).toBeVisible();
  expect(screen.getByRole("textbox", { name: "Stay location" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Save Stay" })).toBeDisabled();
  const signal = vi.mocked(researchStayAddress).mock.calls[0][3]!;
  unmount();
  expect(signal.aborted).toBe(true);
});

test("an existing stay can still be removed without a search", async () => {
  vi.mocked(saveStayLocation).mockResolvedValue();
  const { onSaved } = showDrawer(savedDestination);
  fireEvent.click(screen.getByRole("button", { name: "Remove Stay" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
  expect(saveStayLocation).toHaveBeenCalledWith("trip", "tokyo-jp", null);
  expect(researchStayAddress).not.toHaveBeenCalled();
});
