import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import ColorSchemeProvider from "../../app/ColorSchemeProvider";
import StayLocationDrawer from "./StayLocationDrawer";
import { searchPlaces } from "../../api/api";
import {
  saveStayLocation,
  type Destination,
} from "../activities/activitiesApi";
vi.mock("../../api/api", () => ({ searchPlaces: vi.fn() }));
vi.mock("../activities/activitiesApi", () => ({ saveStayLocation: vi.fn() }));
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
  fireEvent.click(
    await screen.findByRole("option", { name: "Tokyo Hotel, Shinjuku" }),
  );
  expect(searchPlaces).toHaveBeenCalledWith(
    "Tokyo Hotel",
    expect.any(AbortSignal),
    [139.69, 35.68],
    "JP",
  );
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
