import { activityKinds } from "../features/activities/activityKinds";
import type { ClientResource, TripView } from "./tripDocumentStore";

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as ObjectValue)
    : {};
const list = (value: unknown): ObjectValue[] =>
  Array.isArray(value) ? value.map(object) : [];
const text = (value: unknown) => (typeof value === "string" ? value : "");
const metadataFields = new Set([
  "etag",
  "contextVersion",
  "version",
  "canPlan",
  "activitiesEtag",
  "accommodationEtag",
  "connectionsEtag",
  "connectionsVersion",
  "flightPlanningEtag",
  "flightChoicesEtag",
  "bookingEtag",
  "memberEtags",
]);
const without = (value: ObjectValue, keys: string[]) =>
  Object.fromEntries(
    Object.entries(value).filter(
      ([key]) => !metadataFields.has(key) && !keys.includes(key),
    ),
  );

export type DocumentValidator = {
  etag: string;
  contextVersion?: string;
  version?: number;
};

// API addresses are constructed here, never serialized into the trip file.
export function tripDocumentValidators(
  d: TripDocument,
): Record<string, DocumentValidator> {
  const prefix = `/trips/${d.id}`;
  const result: Record<string, DocumentValidator> = {};
  const add = (path: string, value: unknown, scope = "") => {
    const v = object(value);
    const field = (name: string) =>
      scope ? scope + name[0].toUpperCase() + name.slice(1) : name;
    const etag = v[field("etag")];
    if (typeof etag !== "string") return;
    // The document stores a token; REST adapters expose a complete HTTP header value.
    result[prefix + path] = {
      etag: `"${etag}"`,
      ...(typeof v[field("contextVersion")] === "string"
        ? { contextVersion: v[field("contextVersion")] as string }
        : {}),
      ...(typeof v[field("version")] === "number"
        ? { version: v[field("version")] as number }
        : {}),
    };
  };
  if (!d.etag) return result;
  add("", { etag: d.etag });
  for (const p of d.people) add(`/travellers/${p.id}`, p);
  add("/activity-preferences", d.preferences.activities);
  add("/flights/constraints", d.preferences, "flightPlanning");
  add("/travel", d.itinerary, "connections");
  for (const g of list(d.preferences.groups)) {
    add(`/flights/choices/${g.id}`, g, "flightChoices");
    add(`/flights/${g.id}`, g, "booking");
    for (const [id, etag] of Object.entries(object(g.memberEtags)))
      add(`/parties/${g.id}/members/${id}`, { etag });
  }
  for (const p of d.places.filter((p) => p.destinationId)) {
    const path = `/destinations/${encodeURIComponent(text(p.destinationId))}`;
    add(path, { etag: p.etag });
    add(path + "/activities", {
      etag: p.activitiesEtag,
      contextVersion: p.contextVersion,
    });
    for (const v of d.itinerary.items
      .filter((item) => item.kind === "visit")
      .filter((v) => v.destinationId === p.destinationId)) {
      add(`${path}/stays/${v.id}`, v);
      const lodging = d.itinerary.items.find(
        (item) => item.kind === "lodging" && item.visitId === v.id,
      );
      if (lodging) add(`${path}/stays/${v.id}/location`, lodging);
      else add(`${path}/stays/${v.id}/location`, v, "accommodation");
    }
    for (const a of d.itinerary.items
      .filter((item) => item.kind === "activity")
      .filter((a) => a.destinationId === p.destinationId))
      add(`${path}/activities/${a.id}`, a);
    const preferences = list(d.preferences.destinations).find(
      (v) => v.destinationId === p.destinationId,
    );
    add(path + "/activity-preferences", preferences?.activities);
    add(path + "/activity-plan", preferences?.schedule);
  }
  return result;
}

export type TripDocument = {
  schemaVersion: 1;
  id: string;
  name: string;
  description: string;
  revision: string;
  createdAt: string;
  updatedAt: string;
  originPlaceId: string;
  people: ObjectValue[];
  places: ObjectValue[];
  itinerary: {
    items: ObjectValue[];
    connectionsEtag?: string;
    connectionsVersion?: number;
  };
  preferences: ObjectValue;
  etag?: string;
  canPlan?: boolean;
};

export function validateTripDocument(
  value: unknown,
  tripId: string,
): TripDocument {
  const d = object(value);
  if (
    d.schemaVersion !== 1 ||
    d.id !== tripId ||
    typeof d.name !== "string" ||
    !Array.isArray(d.people) ||
    !Array.isArray(d.places) ||
    !Array.isArray(object(d.itinerary).items) ||
    !d.preferences
  )
    throw new Error("This trip document format is unsupported.");
  const ids = new Set<string>();
  for (const item of list(object(d.itinerary).items)) {
    if (
      !["event", "task"].includes(text(item.type)) ||
      ![
        "visit",
        "lodging",
        "activity",
        "flight",
        "connection",
        "transfer",
      ].includes(text(item.kind)) ||
      typeof item.id !== "string" ||
      typeof item.name !== "string" ||
      typeof item.busy !== "boolean" ||
      (item.type === "event" && typeof item.start !== "string") ||
      (item.type === "task" && item.busy !== false)
    )
      throw new Error("Invalid trip calendar item.");
    if (
      item.kind === "activity" &&
      (!Array.isArray(item.kinds) ||
        item.kinds.length === 0 ||
        item.kinds.length > activityKinds.length ||
        item.kinds.some(
          (kind: unknown) =>
            !activityKinds.includes(kind as (typeof activityKinds)[number]),
        ) ||
        new Set(item.kinds).size !== item.kinds.length ||
        !["Unknown", "Required", "NotRequired"].includes(
          text(item.ticketRequirement),
        ) ||
        (item.address != null &&
          (typeof item.address !== "string" || item.address.length > 2000)))
    )
      throw new Error("Invalid activity details.");
    if (ids.has(text(item.id)))
      throw new Error("Duplicate trip calendar item.");
    ids.add(text(item.id));
  }
  const fail = () => {
    throw new Error("Invalid trip document edit validator.");
  };
  const token = (value: unknown) => /^[!#-~\u0080-\u00ff]+$/.test(text(value));
  const validateFields = (value: unknown) => {
    const fields = object(value);
    if (
      ["href", "resources", "data", "status", "contentType", "sync"].some(
        (key) => key in fields,
      )
    )
      fail();
    for (const [key, item] of Object.entries(fields)) {
      if ((key === "etag" || key.endsWith("Etag")) && !token(item)) fail();
      if (
        (key === "version" ||
          (key.endsWith("Version") && key !== "contextVersion")) &&
        metadataFields.has(key) &&
        !Number.isSafeInteger(item)
      )
        fail();
      if (key === "contextVersion" && typeof item !== "string") fail();
      if (key === "memberEtags") {
        if (!item || typeof item !== "object" || Array.isArray(item)) fail();
        for (const [id, tag] of Object.entries(object(item))) {
          if (!/^[a-f0-9-]+$/i.test(id) || !token(tag)) fail();
        }
      }
    }
  };
  [
    d,
    ...list(d.people),
    ...list(d.places),
    ...list(object(d.itinerary).items),
    object(d.itinerary),
    object(d.preferences),
    object(d.preferences).activities,
    ...list(object(d.preferences).groups),
    ...list(object(d.preferences).destinations).flatMap((p) => [
      p.activities,
      p.schedule,
    ]),
  ].forEach(validateFields);
  if (d.etag !== undefined && typeof d.canPlan !== "boolean") fail();
  return value as TripDocument;
}

// Client-owned REST adapters. The document has one canonical domain model; these
// transient read representations are neither part of its wire contract nor saved in it.
export function hydrateTripDocument(document: TripDocument): TripView {
  const d = document;
  const prefix = `/trips/${d.id}`;
  const metadata = tripDocumentValidators(d);
  const resources: Record<string, ClientResource> = {};
  const add = (path: string, data: unknown) => {
    const key = prefix + path;
    const version = metadata[key];
    // A portable file has no edit authority. Read-only views still work without validators.
    resources[key] = {
      href: key,
      etag: version?.etag ?? "",
      contextVersion: version?.contextVersion,
      status:
        path === "/flights" && Array.isArray(data) && data.length === 0
          ? 204
          : path.endsWith("/location") && data === null
            ? 404
            : 200,
      contentType:
        (path.startsWith("/destinations") &&
          !path.includes("/stays/") &&
          !path.endsWith("activity-preferences")) ||
        path.endsWith("/location")
          ? "application/geo+json"
          : "application/json",
      data,
    };
  };
  const owner = d.people.find((p) => p.isOwner);
  const dates = d.itinerary.items
    .filter((item) => item.kind === "visit")
    .sort((a, b) => Number(a.order) - Number(b.order));
  add("", {
    id: d.id,
    name: d.name,
    description: d.description,
    ownerUserId: owner?.id,
    constraints: d.preferences.constraints,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    canPlan: d.etag ? (d.canPlan ?? false) : false,
    startDate: dates[0]?.start ?? dates[0]?.end ?? null,
    endDate: dates.at(-1)?.end ?? dates.at(-1)?.start ?? null,
    etag: metadata[prefix]?.etag,
  });
  const member = (p: ObjectValue) => ({
    id: p.id,
    name: p.name,
    homeCity: p.homeCityName,
    role: p.isOwner ? "Planner" : p.role,
  });
  const groups = list(d.preferences.groups).map((g) => ({
    ...without(g, ["personIds", "booking"]),
    id: text(g.id),
    members: (g.personIds as string[])
      .map((id) => d.people.find((p) => p.id === id))
      .filter((p): p is ObjectValue => !!p)
      .map(member),
  }));
  add("/parties", groups);
  const travellers = groups
    .flatMap((g) => g.members)
    .sort((a, b) => text(a.id).localeCompare(text(b.id)));
  add("/travellers", travellers);
  for (const p of travellers) add(`/travellers/${p.id}`, p);
  for (const g of groups)
    for (const p of d.people)
      add(
        `/parties/${g.id}/members/${p.id}`,
        g.members.some((m) => m.id === p.id)
          ? { memberId: p.id, role: p.role }
          : null,
      );
  add("/activity-preferences", without(object(d.preferences.activities), []));
  add(
    "/flights",
    list(d.preferences.groups).flatMap((g) => (g.booking ? [g.booking] : [])),
  );
  for (const g of groups)
    add(
      `/flights/${g.id}`,
      list(d.preferences.groups).find((source) => source.id === g.id)
        ?.booking ?? null,
    );
  const choices = list(d.preferences.flightChoices).map((choice) => ({
    ...without(choice, ["groupId", "journeys"]),
    partyId: choice.groupId,
    flights: list(choice.journeys)
      .filter((j) => j.legIndex !== null)
      .map((j) => ({ legIndex: j.legIndex, leg: j.details })),
    unmatchedFlights: list(choice.journeys)
      .filter((j) => j.legIndex === null)
      .map((j) => j.details),
  }));
  add("/flights/choices", choices);
  for (const g of groups)
    add(
      `/flights/choices/${g.id}`,
      choices.find((c) => c.partyId === g.id) ?? {
        partyId: g.id,
        legKeys: [],
        nextOrigins: [],
        flights: [],
        unmatchedFlights: [],
        purchasedOfferIds: [],
        bookings: [],
      },
    );
  add("/travel", {
    connections: d.itinerary.items
      .filter((l) => l.kind === "connection")
      .map((l) =>
        without(l, ["kind", "type", "busy", "start", "end", "duration"]),
      ),
    version: metadata[prefix + "/travel"]?.version ?? 0,
  });
  const destinationPreferences = list(d.preferences.destinations);
  const features = destinationPreferences
    .map((pref) =>
      d.places.find((p) => p.destinationId === pref.destinationId)!,
    )
    .map((p) => {
      const preference = destinationPreferences.find(
        (v) => v.destinationId === p.destinationId,
      );
      const path = `/destinations/${encodeURIComponent(text(p.destinationId))}`;
      const cityVisits = dates
        .filter((v) => v.destinationId === p.destinationId)
        .map((v): ObjectValue => {
          const lodging = d.itinerary.items.find(
            (item) => item.kind === "lodging" && item.visitId === v.id,
          );
          const stay = d.places.find((place) => place.id === lodging?.placeId);
          return {
            id: v.id,
            order: v.order,
            arrivalDate: v.start ?? null,
            departureDate: v.end ?? null,
            arrivalAt: v.start ?? "",
            departureAt: v.end ?? "",
            stayLocation: stay
              ? {
                  type: "Feature",
                  id: v.id,
                  geometry: stay.location,
                  properties: { name: stay.name },
                }
              : null,
          };
        });
      const feature = {
        type: "Feature",
        id: p.destinationId,
        geometry: p.location,
        properties: {
          name: p.name,
          countryCode: p.countryCode,
          timeZone: p.timeZone,
          contextVersion:
            metadata[prefix + path + "/activities"]?.contextVersion ??
            metadata[prefix + path]?.contextVersion ??
            "",
          arrivalDate:
            cityVisits.length === 1 ? cityVisits[0].arrivalDate : null,
          departureDate:
            cityVisits.length === 1 ? cityVisits[0].departureDate : null,
          stays: cityVisits,
          isActive: p.active,
          constraints: preference?.constraints,
        },
      };
      add(path, feature);
      for (const visit of cityVisits) {
        add(`${path}/stays/${visit.id}`, visit);
        add(`${path}/stays/${visit.id}/location`, visit.stayLocation);
      }
      const activities = d.itinerary.items
        .filter((item) => item.kind === "activity")
        .filter((a) => a.destinationId === p.destinationId);
      const activityFeatures = activities.map((a) => ({
        type: "Feature",
        id: a.id,
        geometry:
          d.places.find((place) => place.id === a.placeId)?.location ?? null,
        properties: {
          ...without(a, [
            "id",
            "destinationId",
            "placeId",
            "selection",
            "rule",
            "visitId",
            "kind",
            "type",
            "busy",
            "start",
            "end",
            "timeZone",
            "duration",
            "estimatedDuration",
          ]),
          duration: a.estimatedDuration,
        },
      }));
      add(path + "/activities", {
        type: "FeatureCollection",
        features: activityFeatures,
        route: null,
      });
      for (const a of activityFeatures) add(`${path}/activities/${a.id}`, a);
      add(
        path + "/activity-preferences",
        without(object(preference?.activities), []),
      );
      return feature;
    });
  const route = dates.map((v) => ({
    destinationId: v.destinationId,
    stayId: v.id,
  }));
  add("/destinations", {
    type: "FeatureCollection",
    features: features.filter((f) => f.properties.isActive),
    route,
  });
  add("/destinations?includeInactive=true", {
    type: "FeatureCollection",
    features,
    route,
  });
  return {
    name: d.name,
    revision: d.revision,
    resources,
    document: d,
    places: d.places.map((p) => ({
      ...p,
      id: text(p.id),
      name: text(p.name),
      timeZone: typeof p.timeZone === "string" ? p.timeZone : undefined,
      iataCode: typeof p.iataCode === "string" ? p.iataCode : undefined,
      address: p.address as { addressLocality?: string } | undefined,
    })),
  };
}
