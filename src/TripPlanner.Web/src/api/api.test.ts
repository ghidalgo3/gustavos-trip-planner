import { afterEach, expect, test, vi } from "vitest";
import { formatCityLabel, searchCities } from "./api";

afterEach(() => vi.unstubAllGlobals());

test.each([
  ["Atlanta, Ga.", "Atlanta, GA"],
  ["Boston, Massachusetts, United States", "Boston, MA, United States"],
  ["Paris, France", "Paris, France"],
])("formats city label %s", (input, expected) => {
  expect(formatCityLabel(input)).toBe(expected);
});

test("does not reinterpret a foreign region as a US state", () => {
  expect(formatCityLabel("Tbilisi, Georgia", "GE")).toBe("Tbilisi, Georgia");
});

test("reads city and country metadata from Azure Maps autocomplete", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        token: "maps-sas",
        endpoint: "https://atlas.example.test",
        expiresAt: "2030-01-01T02:00:00Z",
      }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        features: [
          {
            type: "Feature",
            geometry: null,
            properties: {
              type: "PopulatedPlace",
              address: {
                locality: "Boston",
                formattedAddress: "Boston, Massachusetts, United States",
                countryRegion: { ISO: "US", name: "United States" },
              },
            },
          },
        ],
      }),
    });
  vi.stubGlobal("fetch", fetch);

  expect(await searchCities("Bos")).toEqual([
    {
      id: "Boston, Massachusetts, United States-0",
      label: "Boston, MA, United States",
      cityName: "Boston",
      countryCode: "US",
      longitude: undefined,
      latitude: undefined,
    },
  ]);
  expect(fetch.mock.calls[1][0]).toContain("resultTypes=PopulatedPlace");
});

test("reports an expired Maps token without calling Azure Maps", async () => {
  vi.resetModules();
  const fetch = vi.fn().mockResolvedValue({
    ok: false,
    status: 503,
    json: async () => ({
      title:
        "Azure Maps token expired. Restart the local development server to renew it.",
    }),
  });
  vi.stubGlobal("fetch", fetch);

  const { getMapToken } = await import("./api");
  await expect(getMapToken()).rejects.toThrow("Azure Maps token expired");
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("map retry bypasses a cached token that has not expired", async () => {
  vi.resetModules();
  const { getMapToken } = await import("./api");
  const token = (value: string) => ({
    token: value,
    endpoint: "https://atlas.microsoft.com",
    expiresAt: "2099-01-01T00:00:00Z",
  });
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json(token("cached")))
    .mockResolvedValueOnce(Response.json(token("fresh")));
  vi.stubGlobal("fetch", fetch);
  expect((await getMapToken()).token).toBe("cached");
  expect((await getMapToken()).token).toBe("cached");
  expect(fetch).toHaveBeenCalledTimes(1);
  expect((await getMapToken(undefined, true)).token).toBe("fresh");
  expect((await getMapToken()).token).toBe("fresh");
  expect(fetch).toHaveBeenCalledTimes(2);
});

test.each([
  { query: "Louvre", name: "Louvre", address: "Paris, France" },
  {
    query: "10 Rue de Rivoli",
    name: undefined,
    address: "10 Rue de Rivoli, Paris, France",
  },
])(
  "finds venues and addresses near the destination with fuzzy search: $query",
  async ({ query, name, address }) => {
    vi.resetModules();
    const { searchPlaces } = await import("./api");
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
            {
              id: "museum",
              poi: name ? { name } : undefined,
              address: { freeformAddress: address, countryCode: "FR" },
              position: { lon: 2.33, lat: 48.86 },
            },
            { id: "unlocated", poi: { name: "Unknown" } },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetch);
    expect(await searchPlaces(query, undefined, [2.35, 48.86], "FR")).toEqual([
      {
        id: "museum",
        label: [name, address].filter(Boolean).join(", "),
        name,
        address,
        longitude: 2.33,
        latitude: 48.86,
      },
    ]);
    const request = new URL(fetch.mock.calls[1][0]);
    expect(request.pathname).toBe("/search/fuzzy/json");
    expect(request.searchParams.get("query")).toBe(query);
    expect(request.searchParams.get("idxSet")).toBe("POI,PAD,Addr");
    expect(request.searchParams.get("lon")).toBe("2.35");
    expect(request.searchParams.get("lat")).toBe("48.86");
    expect(request.searchParams.get("radius")).toBe("50000");
    expect(request.searchParams.get("countrySet")).toBe("FR");
    expect(fetch.mock.calls[1][1].headers).toEqual({
      Authorization: "jwt-sas sas",
    });
  },
);

test("Tokyo activity lookup rejects distant, foreign, and unverified-country results", async () => {
  vi.resetModules();
  const { searchPlaces } = await import("./api");
  const fetchMock = vi
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
          {
            id: "tokyo",
            poi: { name: "Museum" },
            address: { countryCode: "JP" },
            position: { lon: 139.7, lat: 35.68 },
          },
          {
            id: "china",
            poi: { name: "Museum" },
            address: { countryCode: "CN" },
            position: { lon: 121.47, lat: 31.23 },
          },
          {
            id: "osaka",
            poi: { name: "Museum" },
            address: { countryCode: "JP" },
            position: { lon: 135.5, lat: 34.7 },
          },
          {
            id: "wrong-country",
            poi: { name: "Museum" },
            address: { countryCode: "CN" },
            position: { lon: 139.7, lat: 35.68 },
          },
          {
            id: "unknown-country",
            poi: { name: "Museum" },
            position: { lon: 139.7, lat: 35.68 },
          },
        ],
      }),
    );
  vi.stubGlobal("fetch", fetchMock);
  expect(
    (await searchPlaces("Museum", undefined, [139.69, 35.69], "JP")).map(
      (place) => place.id,
    ),
  ).toEqual(["tokyo"]);
  const url = new URL(fetchMock.mock.calls[1][0]);
  expect(url.searchParams.get("radius")).toBe("50000");
  expect(url.searchParams.get("countrySet")).toBe("JP");
});

test("hotel autocomplete requests predictive fuzzy results with spelling correction", async () => {
  vi.resetModules();
  const { searchPlaces } = await import("./api");
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({
        token: "sas",
        endpoint: "https://atlas.example.test",
        expiresAt: "2099-01-01T00:00:00Z",
      }),
    )
    .mockResolvedValueOnce(Response.json({ results: [] }));
  vi.stubGlobal("fetch", fetch);
  await searchPlaces("Toky hot", undefined, [139.69, 35.68], "JP", {
    typeahead: true,
  });
  const request = new URL(fetch.mock.calls[1][0]);
  expect(request.pathname).toBe("/search/fuzzy/json");
  expect(request.searchParams.get("query")).toBe("Toky hot");
  expect(request.searchParams.get("typeahead")).toBe("true");
  expect(request.searchParams.get("maxFuzzyLevel")).toBe("2");
  expect(request.searchParams.get("countrySet")).toBe("JP");
});
