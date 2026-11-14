import { afterEach, expect, test, vi } from "vitest";
import { createAzureMapsClient } from "./AzureMapsClient";

afterEach(() => vi.unstubAllGlobals());

function mapsFetch(cell: unknown, ok = true) {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        token: "sas",
        endpoint: "https://atlas.example.test",
        expiresAt: "2099-01-01T00:00:00Z",
      }),
    })
    .mockResolvedValueOnce({
      ok,
      json: async () => ({ properties: { matrix: [cell] } }),
    });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

test.each(["driving", "walking"] as const)(
  "requests a %s estimate with GeoJSON longitude/latitude and authenticated SAS",
  async (mode) => {
    const fetch = mapsFetch({
      statusCode: 200,
      durationInSeconds: 120,
      durationTrafficInSeconds: 181,
    });
    const client = createAzureMapsClient();
    expect(
      await client.estimateTravelTime([2.3, 48.8], [2.35, 48.86], mode),
    ).toBe("PT4M");
    expect(fetch.mock.calls[1][0]).toBe(
      "https://atlas.example.test/route/matrix?api-version=2025-01-01",
    );
    const request = fetch.mock.calls[1][1];
    expect(request).toMatchObject({
      method: "POST",
      headers: {
        Authorization: "jwt-sas sas",
        "Content-Type": "application/geo+json",
      },
    });
    expect(JSON.parse(request.body)).toEqual({
      type: "FeatureCollection",
      travelMode: mode,
      departAt: "any",
      traffic: "historical",
      features: [
        {
          type: "Feature",
          geometry: { type: "MultiPoint", coordinates: [[2.3, 48.8]] },
          properties: { pointType: "origins" },
        },
        {
          type: "Feature",
          geometry: { type: "MultiPoint", coordinates: [[2.35, 48.86]] },
          properties: { pointType: "destinations" },
        },
      ],
    });
  },
);

test.each([0, 60, 61])(
  "falls back to non-traffic duration of %s seconds and rounds up",
  async (seconds) => {
    mapsFetch({ statusCode: 200, durationInSeconds: seconds });
    expect(
      await createAzureMapsClient().estimateTravelTime(
        [0, 0],
        [1, 1],
        "walking",
      ),
    ).toBe(`PT${Math.ceil(seconds / 60)}M`);
  },
);

test.each([
  null,
  { statusCode: 404, durationInSeconds: 100 },
  { statusCode: 200 },
  { statusCode: 200, durationInSeconds: -1 },
  { statusCode: 200, durationInSeconds: "100" },
])("rejects unavailable or invalid route summaries: %j", async (cell) => {
  mapsFetch(cell);
  await expect(
    createAzureMapsClient().estimateTravelTime([0, 0], [1, 1], "walking"),
  ).rejects.toThrow("could not find a route");
});

test("provider failure is retryable", async () => {
  mapsFetch(null, false);
  await expect(
    createAzureMapsClient().estimateTravelTime([0, 0], [1, 1], "driving"),
  ).rejects.toThrow("Try again");
});

test.each([{ point: [181, 0] }, { point: [0, 91] }, { point: [NaN, 0] }])(
  "rejects invalid coordinates before making provider calls: %j",
  async ({ point }) => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(
      createAzureMapsClient().estimateTravelTime(
        point as [number, number],
        [1, 1],
        "driving",
      ),
    ).rejects.toThrow("Set both locations");
    expect(fetch).not.toHaveBeenCalled();
  },
);
