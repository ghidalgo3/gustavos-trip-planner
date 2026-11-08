// Only for the offline browser regression test. Serves the actual production
// assets with deterministic API fixtures, including a controllable login expiry.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

const {
  trip,
  user,
  airportPlaces,
  flightChoices,
  legacyFlight,
  parties,
  flightConstraints,
  destination,
} = JSON.parse(
  await readFile(new URL("./fixtures.json", import.meta.url), "utf8"),
);
const root = resolve("dist");
let authenticated = true;
let completeSelection = false;
const prefix = `/trips/${trip.id}`;
function tripDocument() {
  const choices = completeSelection ? [] : flightChoices;
  const visits = destination.properties.stays.map((v) => ({
    id: v.id,
    order: v.order,
    kind: "visit",
    type: v.arrivalDate ? "event" : "task",
    name: destination.properties.name,
    busy: false,
    start: v.arrivalDate,
    end: v.departureDate,
    destinationId: destination.id,
    placeId: `urn:tripplanner:${trip.id}:place:${destination.id}`,
  }));
  const cityPlaceId = `urn:tripplanner:${trip.id}:place:${destination.id}`;
  return {
    schemaVersion: 1,
    id: trip.id,
    name: trip.name,
    description: trip.description,
    revision: "1",
    createdAt: trip.createdAt,
    updatedAt: trip.updatedAt,
    originPlaceId: "home",
    people: parties
      .flatMap((g) => g.members)
      .map((p) => ({
        id: p.id,
        name: p.name,
        role: p.role,
        homeCityName: p.homeCity,
        isOwner: p.id === trip.ownerUserId,
      })),
    places: [
      ...airportPlaces.map((p) => ({
        ...p,
        id: p["@id"],
        type: p["@type"] ?? "Airport",
        location: null,
      })),
      {
        id: cityPlaceId,
        type: "Place",
        name: destination.properties.name,
        destinationId: destination.id,
        countryCode: destination.properties.countryCode,
        timeZone: destination.properties.timeZone,
        location: destination.geometry,
        active: true,
        etag: "1",
        activitiesEtag: "1",
      },
    ],
    itinerary: { items: visits },
    preferences: {
      constraints: trip.constraints,
      activities: { instructions: "", defaults: null },
      destinations: [
        {
          destinationId: destination.id,
          constraints: destination.properties.constraints ?? {},
          activities: { instructions: "", defaults: null },
          schedule: {},
        },
      ],
      groups: parties.map(({ members, ...g }) => ({
        ...g,
        personIds: members.map((m) => m.id),
        booking: completeSelection ? legacyFlight : null,
      })),
      flightChoices: choices.map(
        ({ partyId, flights, unmatchedFlights, ...c }) => ({
          ...c,
          groupId: partyId,
          journeys: [
            ...(flights ?? []).map((f) => ({
              legIndex: f.legIndex,
              details: f.leg,
            })),
            ...(unmatchedFlights ?? []).map((f) => ({
              legIndex: null,
              details: f,
            })),
          ],
        }),
      ),
    },
    canPlan: trip.canPlan,
    etag: "1",
  };
}
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1:4174");
    function json(value, status = 200) {
      response.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      response.end(JSON.stringify(value));
    }
    if (url.pathname === "/__test/session" && request.method === "POST") {
      let body = "";
      for await (const part of request) body += part;
      const data = JSON.parse(body);
      authenticated = data.authenticated;
      completeSelection = data.selection === "complete";
      json({ authenticated });
      return;
    }
    if (url.pathname === "/telemetry/config") {
      json({});
      return;
    }
    if (url.pathname === "/user") {
      json(authenticated ? user : {}, authenticated ? 200 : 401);
      return;
    }
    if (url.pathname === `/user/${user.id}/trips`) {
      json(authenticated ? [trip] : {}, authenticated ? 200 : 401);
      return;
    }
    if (url.pathname === `${prefix}/flights/constraints`) {
      json(authenticated ? flightConstraints : {}, authenticated ? 200 : 401);
      return;
    }
    if (url.pathname === `${prefix}/document`) {
      json(authenticated ? tripDocument() : {}, authenticated ? 200 : 401);
      return;
    }
    if (
      url.pathname === "/operations" ||
      url.pathname === `${prefix}/flights/search`
    ) {
      json([]);
      return;
    }
    const spa =
      url.pathname === "/" ||
      url.pathname === "/profile" ||
      url.pathname === prefix ||
      (url.pathname.startsWith(prefix + "/") &&
        request.headers.accept?.includes("text/html"));
    const filename = resolve(
      root,
      spa ? "index.html" : "." + decodeURIComponent(url.pathname),
    );
    if (!filename.startsWith(root + sep)) {
      json({}, 404);
      return;
    }
    const bytes = await readFile(filename);
    const mime =
      {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".webmanifest": "application/manifest+json",
      }[extname(filename)] ?? "application/octet-stream";
    response.writeHead(200, {
      "Content-Type": mime,
      "Cache-Control": "no-store",
    });
    response.end(bytes);
  } catch {
    response.writeHead(404);
    response.end();
  }
});
server.listen(4174, "127.0.0.1");
