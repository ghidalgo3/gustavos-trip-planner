import { mapsClient } from "../../maps/mapsClient";
import { afterEach, expect, test, vi } from "vitest";
import {
  addDestination,
  deleteDestination,
  searchStayPlaces,
  type Destination,
} from "./activitiesApi";

vi.mock("../../maps/mapsClient", () => ({
  mapsClient: { searchPlaces: vi.fn() },
}));
afterEach(() => vi.unstubAllGlobals());

test("creates a destination using the selected city as a GeoJSON Feature", async () => {
  const feature = {
    type: "Feature",
    id: "paris-fr",
    geometry: { type: "Point", coordinates: [2.3522, 48.8566] },
    properties: {
      name: "Paris",
      countryCode: "FR",
      arrivalDate: "2027-06-10",
      departureDate: null,
      constraints: {},
    },
  };
  const fetchMock = vi.fn<typeof fetch>(async () =>
    Response.json(feature, { status: 201 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const result = await addDestination("trip", {
    name: "Paris",
    countryCode: "FR",
    longitude: 2.3522,
    latitude: 48.8566,
    arrivalDate: "2027-06-10",
    departureDate: null,
  });
  expect(result).toEqual(feature);
  const [url, request] = fetchMock.mock.calls[0];
  expect(url).toMatch(/\/trips\/trip\/destinations$/);
  expect(request!.method).toBe("POST");
  expect(JSON.parse(String(request!.body))).toEqual({
    type: feature.type,
    geometry: feature.geometry,
    properties: feature.properties,
  });
});

test("deletes the city resource using encoded route identifiers", async () => {
  const fetchMock = vi.fn<typeof fetch>(
    async () => new Response(null, { status: 204 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  await deleteDestination("trip/id", "Paris / FR");
  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringMatching(
      /\/trips\/trip%2Fid\/destinations\/Paris%20%2F%20FR$/,
    ),
    { method: "DELETE", credentials: "include" },
  );
});

test("reports a failed destination deletion", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({ title: "Deletion failed." }, { status: 500 }),
    ),
  );
  await expect(deleteDestination("trip", "paris-fr")).rejects.toThrow(
    "Deletion failed.",
  );
});

test("accommodation lookup uses Maps without a server research request", async () => {
  const destination: Destination = {
    type: "Feature",
    id: "tokyo-jp",
    geometry: { type: "Point", coordinates: [139.69, 35.68] },
    properties: {
      name: "Tokyo",
      countryCode: "JP",
      timeZone: "Asia/Tokyo",
      contextVersion: "context",
      arrivalDate: null,
      departureDate: null,
      stays: [],
      isActive: true,
    },
  };
  vi.mocked(mapsClient.searchPlaces).mockResolvedValue([
    {
      id: "hotel",
      name: "Hotel",
      label: "Hotel, Shibuya",
      address: "Shibuya, Tokyo",
      longitude: 139.7,
      latitude: 35.65,
    },
  ]);
  const fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
  const controller = new AbortController();
  const results = await searchStayPlaces(
    destination,
    "Hotel",
    controller.signal,
  );
  expect(mapsClient.searchPlaces).toHaveBeenCalledWith(
    "Hotel",
    controller.signal,
    [139.69, 35.68],
    "JP",
  );
  expect(results).toEqual([
    {
      name: "Hotel",
      address: "Shibuya, Tokyo",
      geometry: { type: "Point", coordinates: [139.7, 35.65] },
    },
  ]);
  expect(fetchMock).not.toHaveBeenCalled();
});
