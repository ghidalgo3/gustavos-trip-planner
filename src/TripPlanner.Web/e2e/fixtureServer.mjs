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
const resource = (href, data, status = 200) => ({
  href,
  data,
  status,
  etag: '"1"',
  contentType: "application/json",
});
const snapshot = {
  "@type": "Trip",
  "@id": `urn:uuid:${trip.id}`,
  schemaVersion: 1,
  revision: "1",
  name: trip.name,
  places: airportPlaces,
  resources: {
    [prefix]: resource(prefix, trip),
    [`${prefix}/destinations`]: resource(`${prefix}/destinations`, {
      type: "FeatureCollection",
      features: [destination],
      route: [
        {
          destinationId: destination.id,
          stayId: destination.properties.stays[0].id,
        },
      ],
    }),
    [`${prefix}/flights`]: resource(`${prefix}/flights`, [], 204),
    [`${prefix}/flights/choices`]: resource(
      `${prefix}/flights/choices`,
      flightChoices,
    ),
    [`${prefix}/flights/constraints`]: resource(
      `${prefix}/flights/constraints`,
      flightConstraints,
    ),
    [`${prefix}/parties`]: resource(`${prefix}/parties`, parties),
    [`${prefix}/destinations/${destination.id}/activities`]: resource(
      `${prefix}/destinations/${destination.id}/activities`,
      { type: "FeatureCollection", features: [] },
    ),
    [`${prefix}/destinations/${destination.id}/activity-plan`]: resource(
      `${prefix}/destinations/${destination.id}/activity-plan`,
      { version: 0 },
    ),
  },
};
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
    if (url.pathname === `${prefix}/snapshot`) {
      const selectedSnapshot = completeSelection
        ? {
            ...snapshot,
            resources: {
              ...snapshot.resources,
              [`${prefix}/flights`]: resource(`${prefix}/flights`, [
                legacyFlight,
              ]),
              [`${prefix}/flights/choices`]: resource(
                `${prefix}/flights/choices`,
                [],
              ),
            },
          }
        : snapshot;
      json(authenticated ? selectedSnapshot : {}, authenticated ? 200 : 401);
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
