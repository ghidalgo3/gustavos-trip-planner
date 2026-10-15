import { afterEach, expect, test, vi } from "vitest";
import {
  addDestination,
  deleteDestination,
  importActivityImages,
  type Destination,
} from "./activitiesApi";

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

test("uploads the selected image batch in one multipart request", async () => {
  const fetchMock = vi.fn<typeof fetch>(async () =>
    Response.json({ id: "operation" }, { status: 202 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const destination: Destination = {
    type: "Feature",
    id: "tokyo-jp",
    geometry: { type: "Point", coordinates: [139.69, 35.69] },
    properties: {
      name: "Tokyo",
      countryCode: "JP",
      timeZone: null,
      contextVersion: "context",
      arrivalDate: null,
      departureDate: null,
      stays: [],
      isActive: true,
    },
  };
  const files = [
    new File(["first"], "first.png", { type: "image/png" }),
    new File(["second"], "second.jpg", { type: "image/jpeg" }),
  ];
  await importActivityImages(
    "trip",
    destination,
    files,
    "Extract food activities",
  );
  const [url, request] = fetchMock.mock.calls[0];
  expect(url).toMatch(/\/trips\/trip\/destinations\/tokyo-jp:import$/);
  const form = request!.body as FormData;
  expect(
    (form.getAll("images") as File[]).map((file) => [
      file.name,
      file.size,
      file.type,
    ]),
  ).toEqual(files.map((file) => [file.name, file.size, file.type]));
  expect(form.get("destinationContext")).toBe("context");
  expect(form.get("input")).toBe("Extract food activities");
  expect(form.get("requestId")).toBeTruthy();
});
