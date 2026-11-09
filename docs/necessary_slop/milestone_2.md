# Milestone 2: Destination and activity planning

Historical milestone notes: server-side LLM features described here have been
removed. Current architecture and workflows are documented in [README](../../README.md);
the connected user agent performs and pays for model calls and research.


Status: Implemented scope documented as of 2026-10-15. Remaining work is listed under Follow-ups and validation below.

## Planning model and permissions

A trip contains a name, description, and an object of constraints. Destinations, flights, parties, and activities are separate resources. Destinations are planned directly; flights are not a prerequisite for defining destinations or activities. Selecting, changing, or removing flights does not change the destination plan.

The owner and members with the `Planner` role can edit trip constraints, destinations, activities, Stay locations, and flight plans. `Traveller` members have view access. Only the owner can manage membership and roles or delete the trip. New members default to Traveller. Member PUT replaces membership with a role; an omitted role defaults to Traveller. Trip responses expose the current user's `canPlan` capability. Permission checks also apply to background planning jobs.

Party management has its own **Party** section, separate from Overview and flight search.

## Destination contract

`GET /trips/{tripId}/destinations` returns a GeoJSON FeatureCollection, including an empty collection for a new trip. `POST` accepts a Feature with a required Point geometry and properties `name`, `countryCode`, optional `timeZone`, optional object `constraints`, and nullable `arrivalDate`/`departureDate` for the initial visit:

```json
{
  "type": "Feature",
  "geometry": { "type": "Point", "coordinates": [2.3522, 48.8566] },
  "properties": { "name": "Paris", "countryCode": "FR", "constraints": { "budget": 500 } }
}
```

The server assigns a stable URL-safe Feature `id` matching `{destinationCity}`. Each city returns an opaque `contextVersion` and a `stays` array representing visits. Adding the same city again creates another visit while preserving its place properties, constraints, and shared activity collection. The collection's `route` foreign member records every visit in trip order.

`PUT /trips/{tripId}/destinations/{destinationCity}` replaces the editable place Feature: Point geometry and properties `name`, `countryCode`, `timeZone`, and `constraints`. An optional body `id` must match the URL. Omitting constraints clears them to `{}`. Visit summaries and context are server-managed. `PUT .../stays/{stayId}` replaces a visit's dates; `DELETE .../stays/{stayId}` removes one visit. Dates are optional and independent of flights. Changes to the destination context invalidate stale activity writes.

`DELETE /trips/{tripId}/destinations/{destinationCity}` deletes the city and its visits, activities, generation jobs, and accommodation. Removing individual visits instead preserves the city and its activities for recovery. Cities with no remaining visits are omitted from the default collection; `?includeInactive=true` includes them for read-only activity recovery. Re-adding the same city restores its activity collection.

Selected coordinates distinguish different cities with the same name and country; nearby selections for the same city become repeat visits.

## Stay location contract

Accommodation is separate from both activities and dated visits. One Stay location is shared across all visits to a destination city.

`GET`, `PUT`, and `DELETE /trips/{tripId}/destinations/{destinationCity}/stay` read, replace, or remove a GeoJSON Feature with Point geometry, `properties.name`, and the canonical id `stay`. The destination response includes it as `properties.stayLocation`. Saving accommodation does not create an activity.

## Activity contract

Under `/trips/{tripId}/destinations/{destinationCity}`, `GET` and `POST /activities` list and create activities; `GET`, `PUT`, and `DELETE /activities/{activityId}` operate on one activity.

Activities are GeoJSON Features with a Point or null geometry, name, nullable duration, editable description, nullable cost, free-form state, and a `links` array of `{ "url": "https://…", "label": "Tickets" }` objects. Labels are optional. Up to 20 HTTP(S) links are allowed. Existing activities default to an empty array; links are replaced with the resource and can be cleared with `[]`.

Writes use `Destination-Context`; updates and deletes also use the activity ETag and `If-Match`. Updates replace all editable fields. Unknown locations remain unpinned rather than being placed at the city center.

## AI suggestions and photo extraction

`POST /trips/{tripId}/destinations/{destinationCity}:suggest` accepts a prompt. `POST .../{destinationCity}:import` accepts one to ten JPEG, PNG, or WebP images through repeated multipart `images` fields; legacy `image` fields remain supported. Both require the profile's `LLM` feature flag and create durable operations polled at `/operations/{operationId}`. `GET .../{destinationCity}/suggestions/{operationId}` returns created activities and warnings. Valid activities are saved immediately with state `Proposed`.

Imports are limited to ten files, 10 MB and 20 megapixels per image, and 50 MB total. The API validates all submitted files before queueing. Images are sent together to the assistant, with instructions to extract only explicitly mentioned activities and readable details, deduplicate across images, and return no activities when none are mentioned. Image instructions can narrow extraction but cannot introduce activities absent from the images.

The worker calls the OpenAI Responses API with a strict activity schema, the prompt, destination city/country, and visit dates. It returns at most ten candidates and validates their names, optional cost, and duration. Refused or incomplete responses fail the operation. The worker rechecks permissions and destination context before saving.

Location resolution first uses Azure Maps POI search within 50 km of the destination and in its country. It uses the activity name when `placeName` is missing, normalizes names, and can fall back to high-confidence named-landmark geocoding. Broad administrative results and city centers are excluded.

For both text prompts and image imports, unresolved candidates can trigger a Responses `web_search` fallback. Research receives the original prompt's place names and descriptive clues, destination, and visit dates. It researches only the existing candidate's venue; it cannot add activities or change names, descriptions, costs, or durations. A supporting URL must appear among the actual search sources and is attached as a **Venue source** link. Azure Maps verifies the researched venue before assigning coordinates. Already resolved activities skip research. Ambiguity or research failure leaves the activity unlocated with a warning. Each fallback has a 20-second timeout within the job deadline.

Configuration uses `OpenAI:ApiKey` and `OpenAI:Model`, shared with the flight-form assistant. The implementation calls Responses directly and does not require an Agents SDK.

## Trip workspace UI

The app uses the available window width. The compact top bar's **Trip Planner** link returns home. The trip page shows the trip name without its description or breadcrumbs. **Overview**, **Activities**, **Flights**, and **Party** navigation appears at the top on both laptops and phones.

### Overview and destination dates

A new trip opens on an empty Overview with **Add destination**. Its drawer offers city-level autocomplete and optional visit dates. The user does not enter a country code; the selected city supplies it. Saving adds the visit and closes the drawer; canceling discards the draft.

Overview lists visits chronologically by arrival, or the known departure date, with undated visits last in itinerary order. Cards show activity counts grouped by state, or **Plan Activities** when empty. Failed counts offer retry. Counts are shared across repeat visits. Editors can change dates or delete a destination after confirming removal of all visits and activities.

One calendar selects arrival and departure as a range. Selecting an earlier second day restarts the range; selecting the same day permits a one-day visit. Dates can be cleared. Today is highlighted. Other cities' dated visits, including repeat visits and overlaps, have highlighted ranges with colored labels below the calendar. Keyboard arrows navigate days; Page Up/Down changes months.

The destination drawer also edits arrival and departure flexibility (±0–5 days) and **Keep this destination after the previous one**. These constraints are shared across visits to the city; other constraint properties are preserved.

Flight spacer cards connect home to the first destination, each successive visit, and the last destination back home. Missing home cities display **Home**. Spacers show selected flight numbers, including connecting segments, or **Plan Flights** links.

Each destination has a **Stay** drawer to select accommodation using location lookup scoped to the destination. Existing accommodation can be replaced or removed.

### Activities and maps

Destination tabs include visit dates and preserve the selected city in the URL. Destination creation and date editing stay on Overview. The Activities page has no duplicate destination details section.

On laptops, a compact activity list sits to the left of the map. The workspace fills the remaining viewport; the activity list scrolls while the map remains visible, without a second page scrollbar. On phones, the map sits above the list and receives more space. A Hide map / Show map control collapses it so the activity list fills the available workspace. Selecting an activity restores the map and its details card. Collapsing keeps the map mounted to preserve its view; desktop layout is unchanged. A full-screen map option supports exploration.

List cards show only the activity number and name. The detail card on the map includes a bordered state dropdown for editors, with a contrasting red Delete activity action inside its menu. State changes preserve the other activity fields. Deletion opens a confirmation modal, with errors retained for retry. Travellers see the state without mutation controls. Tapping a card or map marker selects it and presents a detailed card at the bottom of the map. That card contains description, duration, cost, state, links, and editing actions. Markers are numbered bubbles matching the list, with accessible activity names. Accommodation has its own contrasting hotel icon and does not affect numbering. The initial map framing includes the Stay location.

Maps use light gray or dark gray according to the system theme and update without resetting the view. Loading, failures, and token retry are visible. **Direction**, with a share icon, opens Apple Maps on Apple devices or Google Maps elsewhere, using a routing URL in a new tab; supported devices can hand it to the maps app.

In the full-screen mobile map, tapping a marker slides its details card up from the bottom. Editing opens the activity drawer while keeping the full-screen map mounted; saving or canceling returns to that map view.

### Activity drawers and upload feedback

**Add activity** offers place lookup, an AI prompt, or photo import. Lookup is scoped to the destination's country and a 50 km radius, with returned coordinates and country checked in the browser. Selecting a result fills the name and location; manual entry is also supported.

The activity drawer opens from the window's far-left edge without page dimming. It retains drafts after errors and discards them on cancel. State uses a menu button for Proposed, Planned, and Rejected while preserving existing custom states. Currency uses a known-currency selection instead of free-form input. Travellers see the map and activity details without mutation controls.

Accepted photos show thumbnails, filenames, individual removal buttons, and a selection count. Selecting more than ten retains the first ten candidates and reports the limit. Unsupported, empty, oversized, or total-limit-exceeding files are skipped with a filename and reason. Server validation errors are also displayed. A spinner in the fixed drawer footer remains visible throughout AI processing, including extraction and location resolution. Completion summaries and any warnings appear in a dismissible toast with no automatic dismissal.

## Flight planning iteration

The flight page retains search and flight selection; party management lives in Party and the where/when comes from destination resources. The server derives the search document from current cities and visits, with home airports from the trip owner's profile. Repeat visits retain their IDs.

Flight search and composition enforce destination date windows and `keepAfterPrevious`, which defaults to true. The bounded search supports up to three visits and 60 trip days. Saving a complete itinerary persists selected flights, and Overview links display the matching flight numbers.

## Persistence and delivery

PostgreSQL stores destination places and contexts, ordered visits, activities, durable generation jobs, roles, and Stay locations. The in-memory implementation enforces the same planning permissions for tests. Relevant migrations include `0004_IndependentDestinations.sql`, `0006_ActivityJobImageHash.sql`, `0007_PartyRoles.sql`, and `0008_StayLocations.sql`; startup applies migrations automatically.

Multi-image jobs use a JSON batch in the existing binary job payload (`application/vnd.tripplanner.image-batch+json`); single-image jobs retain their original encoding. SHA-256 idempotency covers the complete payload and survives cleanup of source bytes.

Production HTML cache controls and content-hashed assets support fresh SPA loads after publishing. Shared SPA/API routes distinguish browser navigation from API requests, so refreshing a trip route serves the application.

## Follow-ups and validation

Trip constraints exist in the API, but dedicated trip-wide start/end date and flexibility controls are not implemented in the UI. Visits are appended in creation order; explicit reordering remains a follow-up. Other follow-ups are map clustering, operation retention and abandoned-image cleanup, and fuller image decoding/metadata handling. These are not implemented features and are not assigned to milestone 3 by this document.

The latest frontend verification passed all 148 tests across 26 files, lint, and the production build. Vitest is capped at two workers to reduce intermittent resource-contention timeouts while keeping its five-second test timeout. API tests cover planning permissions, destination/activity persistence, Stay locations, and mocked AI/Maps/research behavior. PostgreSQL contract tests require `TRIPPLANNER_TEST_POSTGRES` and use an isolated temporary database.

A final device-level visual/accessibility review and live OpenAI/Azure Maps extraction verification remain; mocked service tests do not establish live provider behavior. This document records the implemented milestone 2 baseline for subsequent milestone planning.
