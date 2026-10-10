# Milestone 2: Destination and activity planning

Status: Initial implementation, updated 2026-10-04.

The trip's destinations are now planned directly. This replaces the earlier decision to derive destinations from the owner's selected flights. A trip owner can select a city from autocomplete, optionally supply arrival and departure dates, and plan activities immediately. The form does not ask for a country code; the selected city result supplies it. Selecting, changing, or removing flights does not change the destination plan or its activities. Flight planning remains a separate part of the trip workspace.

## Destination contract

`GET /trips/{tripId}/destinations` returns a GeoJSON FeatureCollection, including an empty collection for a new trip. `POST` to the same route adds a visit using `name`, a two-letter `countryCode`, optional `longitude` and `latitude` from city autocomplete, and nullable `arrivalDate` and `departureDate`. The server uses the supplied coordinates when present, otherwise resolves the city, and caches its Point. A city Feature has a stable URL-safe `id`, an opaque `contextVersion`, and a `stays` array. Adding a city again creates another stay in that same city resource. The collection's `route` foreign member records every visit in trip order. `PUT /trips/{tripId}/destinations/{destinationCity}/stays/{stayId}` replaces its optional dates, and `DELETE` removes one visit. Dates are optional; the app does not infer them from flights. New destinations return a null time zone until a separate time-zone resolution flow is added.

A city with no remaining visits is absent from the default collection. `?includeInactive=true` returns cached past cities for read-only activity recovery. Re-adding the same city restores its activity collection. Trip members may read, and only the owner may change the destination plan.

`destination_places` persists city identity, Point, and context version; `destination_stays` persists ordered visits and optional dates. The city context rotates when a visit is added or removed. Activity and generation writes check that the city is active and the supplied context is current, independently of flight selection.

## Activity contract

A city has `GET` and `POST /activities`, plus `GET`, `PUT`, and `DELETE /activities/{activityId}`. These routes exchange GeoJSON Features with a Point or null geometry, name, nullable duration, editable description, nullable cost, and free-form state. Updates replace all editable fields. Writes use `Destination-Context`; updates and deletes also use an activity ETag and `If-Match`. Unknown locations stay unpinned rather than being placed at the city center.

`POST /trips/{tripId}/destinations/{destinationCity}:suggest` accepts a prompt and `POST .../{destinationCity}:import` accepts one JPEG, PNG, or WebP image. Both create a durable operation, require the `LLM` feature flag, and save valid suggestions immediately with state `Proposed`. The result is available at `GET .../{destinationCity}/suggestions/{operationId}` after polling `/operations/{operationId}`. Manual activity creation remains available without the feature flag. The worker rechecks the destination context before saving results.

## UI

The Destinations section is the default trip view and starts with an **Add destination** form on an empty trip. Destination tabs sit above a map, activity table, editor, and prompt/image composer. A city visited multiple times has one tab showing all stays; the route summary retains each visit. The selected city stays in the URL. Narrow screens stack these parts for phone use. An inactive city can be viewed through **View past destinations** and becomes editable if added to the plan again.

## Iteration notes

This version appends visits in the order added; an explicit reorder control is a follow-up. Selected city coordinates distinguish different cities with the same name and country, while nearby selections for the same city become repeat visits. Image validation checks encoded dimensions and signatures but does not fully decode or remove metadata. Operation retention and abandoned-image cleanup, map clustering, and device-level visual and accessibility review remain. PostgreSQL migration `0004_IndependentDestinations.sql` follows the initial activity migration; the local PostgreSQL contract test requires an available Docker-backed database.
