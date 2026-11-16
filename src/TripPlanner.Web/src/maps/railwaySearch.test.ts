import { afterEach, expect, test, vi } from "vitest";
import { createAzureMapsClient } from "./AzureMapsClient";

afterEach(() => vi.unstubAllGlobals());

test.each([
  {
    query: "Tokyo station",
    search: "Tokyo",
    name: "Tōkyō",
    country: "JP",
    center: [139.7671, 35.6812],
  },
  {
    query: "Hiroshima train station",
    search: "Hiroshima",
    name: "Hiroshima-eki",
    country: "JP",
    center: [132.4754, 34.3974],
  },
  {
    query: "Gare de Lyon",
    search: "Gare de Lyon",
    name: "Gare de Lyon",
    country: "FR",
    center: [2.3734, 48.8449],
  },
  {
    query: "Berlin Hauptbahnhof",
    search: "Berlin Hauptbahnhof",
    name: "Berlin Hauptbahnhof",
    country: "DE",
    center: [13.3695, 52.5251],
  },
])(
  "$query filters passenger rail stations while preserving provider relevance and names",
  async ({ query, search, name, country, center }) => {
    const poi = (
      id: string,
      stationName: string,
      category: number,
      code = "RAILWAY_STATION",
    ) => ({
      id,
      poi: {
        name: stationName,
        categorySet: [{ id: category }],
        classifications: [{ code }],
      },
      address: { countryCode: country, freeformAddress: "Station address" },
      position: { lon: center[0], lat: center[1] },
    });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          token: "sas",
          endpoint: "https://atlas.example.test",
          expiresAt: "2099-01-01T00:00:00Z",
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          results: [
            poi(
              "petrol",
              "Idemitsu Akasaka Chuo Service Station",
              7309,
              "ELECTRIC_VEHICLE_STATION",
            ),
            poi("airport", "Naval Air Station", 7383, "AIRPORT"),
            poi("other", "Nearby suburban station", 7380004),
            poi("main", name, 7380004),
            { ...poi("unknown", name, 7380004), poi: { name } },
            {
              ...poi("foreign", name, 7380004),
              address: { countryCode: "US" },
            },
            { ...poi("distant", name, 7380004), position: { lon: 0, lat: 0 } },
            { ...poi("unlocated", name, 7380004), position: {} },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetch);
    const results = await createAzureMapsClient().searchPlaces(
      query,
      undefined,
      center as [number, number],
      country,
      { category: "railwayStation" },
    );
    expect(results.map((place) => place.id)).toEqual(["other", "main"]);
    expect(results[1]).toMatchObject({
      name,
      longitude: center[0],
      latitude: center[1],
    });
    const url = new URL(fetch.mock.calls[1][0]);
    expect(url.pathname).toBe("/search/poi/json");
    expect(url.searchParams.get("query")).toBe(search);
    expect(url.searchParams.get("categorySet")?.split(",")).toEqual(
      expect.arrayContaining([
        "7380",
        "7380002",
        "7380003",
        "7380004",
        "7380005",
      ]),
    );
    expect(url.searchParams.get("lat")).toBe(String(center[1]));
    expect(url.searchParams.get("lon")).toBe(String(center[0]));
    expect(url.searchParams.get("countrySet")).toBe(country);
    expect(url.searchParams.get("radius")).toBe("50000");
  },
);
