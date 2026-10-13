# Milestone 2: Destination and activity planning

Status: Initial implementation, updated 2026-10-12.

The trip's destinations are now planned directly. This replaces the earlier decision to derive destinations from the owner's selected flights. A trip owner can select a city from autocomplete, optionally supply arrival and departure dates, and plan activities immediately. The form does not ask for a country code; the selected city result supplies it. Selecting, changing, or removing flights does not change the destination plan or its activities. Flight planning remains a separate part of the trip workspace.

## Destination contract

`GET /trips/{tripId}/destinations` returns a GeoJSON FeatureCollection, including an empty collection for a new trip. `POST` accepts a GeoJSON Feature with a required Point geometry from Azure Maps and properties `name`, `countryCode`, optional `timeZone`, optional object `constraints`, and nullable `arrivalDate`/`departureDate` for the initial stay:

```json
{
  "type": "Feature",
  "geometry": { "type": "Point", "coordinates": [2.3522, 48.8566] },
  "properties": { "name": "Paris", "countryCode": "FR", "constraints": { "budget": 500 } }
}
```

The server assigns a stable URL-safe Feature `id` matching `{destinationCity}`. A city Feature also returns an opaque `contextVersion` and a `stays` array. Adding the same city again creates another stay while preserving its place properties and constraints. The collection's `route` foreign member records every visit in trip order. `PUT /trips/{tripId}/destinations/{destinationCity}` replaces the complete editable place Feature: Point geometry and properties `name`, `countryCode`, `timeZone`, and `constraints`. Its optional body `id` must match the URL. Omitting constraints clears them to `{}`. Stay summaries and context are server-managed; use `PUT .../stays/{stayId}` to replace a stay's dates and `DELETE .../stays/{stayId}` to remove one visit. Dates are optional and independent of flights. Place updates preserve IDs, stays, and activities, and rotate the context so stale activity writes are rejected.

`DELETE /trips/{tripId}/destinations/{destinationCity}` deletes the city resource and all its stays, activities, and generation jobs. Removing individual stays instead keeps the city and its activities available for recovery.

A city with no remaining visits is absent from the default collection. `?includeInactive=true` returns cached past cities for read-only activity recovery. Re-adding the same city restores its activity collection. Trip members may read, and only the owner may change the destination plan.

`destination_places` persists city identity, Point, destination constraints, and context version; `destination_stays` persists ordered visits and optional dates. The city context rotates when a visit is added or removed. Activity and generation writes check that the city is active and the supplied context is current, independently of flight selection.

## Activity contract

A city has `GET` and `POST /activities`, plus `GET`, `PUT`, and `DELETE /activities/{activityId}`. These routes exchange GeoJSON Features with a Point or null geometry, name, nullable duration, editable description, nullable cost, and free-form state. Updates replace all editable fields. Writes use `Destination-Context`; updates and deletes also use an activity ETag and `If-Match`. Unknown locations stay unpinned rather than being placed at the city center.

`POST /trips/{tripId}/destinations/{destinationCity}:suggest` accepts a prompt and `POST .../{destinationCity}:import` accepts one JPEG, PNG, or WebP image. Both create a durable operation, require the `LLM` feature flag, and save valid suggestions immediately with state `Proposed`. The result is available at `GET .../{destinationCity}/suggestions/{operationId}` after polling `/operations/{operationId}`. Manual activity creation remains available without the feature flag. The worker rechecks the destination context before saving results.

The worker calls the OpenAI Responses API with a strict activity schema, the user's prompt, destination city/country, and visit dates. It returns at most 10 candidates, checks names and optional cost/duration values, resolves named places through Azure Maps POI search, and persists valid activities as Proposed. Unverified places remain unpinned, with warnings in the suggestion result. Refused or incomplete OpenAI responses fail the operation rather than saving partial output. Configuration uses `OpenAI:ApiKey` and `OpenAI:Model`, shared with the flight-form assistant; see [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses).

Migration `0006_ActivityJobImageHash.sql` upgrades early databases that lack `activity_jobs.image_sha256`, preserving existing jobs and backfilling hashes for retained images. Startup applies it automatically. The hash also preserves image request idempotency after uploaded bytes are cleaned up.

## UI

The default trip view is **Overview**, initially an empty itinerary with an **Add destination** button. The button opens a modal drawer with city autocomplete and optional arrival/departure dates. The drawer fills a phone's width and sits at the right on larger screens. Saving adds the visit and closes the drawer; canceling discards the draft. Overview lists repeat visits in itinerary order, with links to each city's activities and an **Edit dates** action for each visit. Owners can delete a destination after confirming that all its visits and activities will be removed. Shared-trip members have a read-only overview.

Destination calendars highlight other cities' dated stays, including repeat visits and overlapping dates. Colored labels below the month identify each city and date range. Date fields also accept YYYY-MM-DD text; departure cannot precede arrival. Keyboard arrows navigate days, and Page Up/Down changes months. Trip-wide date and flexibility editing remain a follow-up.

**Activities** shows destination tabs containing each city's visit dates, followed by a full-width Azure map centered on the selected city and an activities table. Destination tabs share a scroll position, so switching cities does not restore a different per-city offset. The selected city stays in the URL and breadcrumbs link back through Trips, the trip, and the current section. Map loading and failures are visible, with a retry that fetches a fresh SAS token. Destination creation and visit-date editing stay on Overview; Activities has no Destination details section or duplicate city/date heading.

**Add activity** and each row's **Edit** action open a drawer. New activities offer place lookup, an AI prompt, or an image import. Lookup uses [Azure Maps POI search](https://learn.microsoft.com/en-us/rest/api/maps/search/get-search-poi?view=rest-maps-1.0) by name near the destination; choosing a result fills the activity name and location. Activities may also be entered manually. AI suggestions and image imports require the profile's AI feature and save activities immediately as Proposed. Activity state uses a menu button for Proposed, Planned, and Rejected, while retaining any existing custom state. The drawer retains the draft after errors and discards it on cancel. Shared-trip members can view the table and map without mutation controls.

## Iteration notes

This version appends visits in the order added; an explicit reorder control is a follow-up. Selected city coordinates distinguish different cities with the same name and country, while nearby selections for the same city become repeat visits. Image validation checks encoded dimensions and signatures but does not fully decode or remove metadata. Operation retention and abandoned-image cleanup, map clustering, and device-level visual and accessibility review remain. PostgreSQL migration `0004_IndependentDestinations.sql` follows the initial activity migration; the local PostgreSQL contract test requires an available Docker-backed database.
