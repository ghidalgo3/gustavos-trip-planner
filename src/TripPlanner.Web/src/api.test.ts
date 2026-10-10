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
