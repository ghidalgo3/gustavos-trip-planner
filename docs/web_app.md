# Web application

## Trips dashboard

The signed-in web dashboard starts with **New trip** and a name search. `GET /trips` and `GET /user/{userId}/trips` return `{ "trips": [...], "hasMore": true }`, with at most 10 trips per page. Query parameters are `skip` (default 0), `search` (case-insensitive name substring), `past` (true for completed trips, false for ongoing/future/undated trips, omitted for all), and `today` (`YYYY-MM-DD`, supplied in the client's local calendar date; defaults to the server's UTC date). Ongoing trips sort first, followed by the nearest future dates, then undated trips; past trips sort most recent first. Name and ID break ties. The dates come from the first and last visits in itinerary order, using the other date on that boundary visit when one is missing. A trip is past when its end date is before today. The dashboard shows available dates, keeps past trips collapsed initially, expands them when searching, and loads another 10 on demand for either section. The database filters and pages before returning results, avoiding per-trip read queries. Offline mode uses the same search, ordering, sections, and paging over the remembered catalog while disabling edits. Loaded pages merge into that catalog without removing downloaded trip documents. The iOS client follows the paged response, and the MCP `list_trips` tool accepts the same query fields.

## Profile and onboarding

During onboarding, the client debounces city searches and calls Azure Maps Geocode Autocomplete directly for `PopulatedPlace` results. `GET /mapToken` returns an authenticated, short-lived SAS for that browser call. The API creates each SAS with a two-hour lifetime and an approximate limit of 50 requests per second; the browser reuses it until shortly before expiry. Selecting a result and continuing calls `PUT /user/profile` with a complete `UserProfile` object. If the city has multiple passenger airports, the profile requires a preferred airport; a sole airport is selected automatically. `GET /airports/home` resolves that list from the bundled catalog. City flight searches still include all airports, with the saved airport used as a ranking preference. The same route saves home-city, preferred-airport, and airline changes from `/profile` in one database update. The avatar button opens a menu with **Your profile** and **Sign out**. Preferred airlines initialize the owner's party preferences in newly opened planning documents.

Airline preferences in the profile and the airline filter in flight results, use the same searchable multi-select combobox. Chosen airlines appear as removable tags; profile and planning preferences persist airline codes, while result filters preserve carrier names in the route query.

## Saving and editing

The UI uses explicit Save/Apply buttons for groups of values that need validation together, and saves independent valid actions directly. Independent free text saves on blur. Automatic saves retain confirmed values or drafts on failure and provide an error and a retry path. Requests still replace complete resources; independent edits preserve other confirmed values rather than submitting unrelated unfinished drafts.

| Editor or action | Save behavior | Reason |
| --- | --- | --- |
| Existing trip name and description | Each field saves on blur | Each field is independently validated; an empty name stays in the editor until corrected |
| Destination visit dates and constraints | **Save dates** | Arrival, departure, flexibility, and ordering must be valid together |
| Stay search result | Selecting a located result saves immediately; removal also saves immediately | A result is a complete accommodation choice; searching alone does not change the saved stay |
| Activity details | **Save activity** | Required name, location, links, duration, and other details are edited as one validated activity draft |
| Home city and preferred airport | **Save home city** | The preferred airport must belong to the selected city's airport choices |
| Preferred airlines | Adding or removing an airline saves immediately | Independent selection; unfinished city edits are preserved locally |
| Private, trip, and destination interests | Each text field saves on blur | Each interest text is independently valid within its length limit |
| Daily activity plan | **Save** in the event editor; drag/drop saves immediately | Complete timing changes are validated and saved with the versioned plan |
| Day name | On blur | Optional independent text; saves the confirmed plan with the new name while retaining unsaved schedule edits |
| Schedule or proposal preview | **Apply schedule / Apply this proposal** | Explicitly accepts an entire proposed replacement plan |
| Complete flight itinerary | **Save complete itinerary** | Commits the complete connected set of itinerary legs; individual flight choices already save when selected |
| New trip, destination, traveler, and onboarding | Explicit **Create**, **Add**, or **Continue** action | Submits a complete new resource or the coupled home-city/airport form |

## Routing and appearance

The web client follows the browser's `prefers-color-scheme` setting and updates
between Fluent UI's light theme and the shared navy/slate dark palette in
`src/TripPlanner.Web/src/app/theme.ts` when that preference changes. Page
backgrounds are solid; drawers and menu portals inherit the same theme tokens.
React Router keeps the trips dashboard at `/` and each planner at `/trips/{tripId}`.
The dashboard also uses `/?create=1` and `/?edit={tripId}` for its forms. These
routes support direct loading, refresh, and browser Back/Forward navigation.
Flight-result filters remain in the query string, so refreshing or sharing the URL restores those filters.

## Map display

The web app uses Leaflet with OpenStreetMap tiles when a destination or either
end of a transportation leg has the country code `KR` (South Korea). Other maps
use the Azure Maps control. Place search and route estimates use Azure Maps for
all destinations.

OpenStreetMap tiles load on demand and use the browser's HTTP cache. To use a
different OpenStreetMap tile host, set `VITE_OPENSTREETMAP_TILE_URL` at build
time to its tile URL template, including `{z}`, `{x}`, and `{y}`. The map shows
OpenStreetMap attribution. [OpenStreetMap tile usage policy](https://operations.osmfoundation.org/policies/tiles/)

## Offline behavior

The web app reads trip views through adapters over its account-scoped document cache, saves through
resource REST APIs, and reloads the document after successful mutations. A stale
write returns `412`; missing edit preconditions return `428`. The UI retains the
draft and offers Refresh; it does not replay stale writes. Cached trips remain
readable offline, with editing disabled. The production service worker caches the
public app shell; authenticated documents are cached separately and cleared on
sign-out or an online access denial. Other tabs/devices do not receive live pushes.

Offline launch also persists the last confirmed display identity and the trip list
in account-scoped local storage; it does not persist authentication credentials.
The installed app can reopen at its home screen without a network connection and
open previously downloaded trips. Trips that have
only appeared in the list need to be opened online once to download their document.
Saved flights include selected individual legs before the route is complete,
purchase status, and displaced selections that need review. Airport cities are
included in the document, so viewing flights and matching them to destination
visits does not require an airport lookup. Offline flights use the same destination
grid as online, with saved selections and booking status. Sorting, filtering,
scrolling, and flight details remain available; search, selection changes, booking
links, and purchase updates are disabled. Offline mode never starts a fare search.
Editing and profile settings remain disabled until the session is verified online.
Offline status appears only after 30 seconds of disconnection, as one compact
line with a Retry button. Short interruptions do not show a banner; read-only
protection takes effect immediately.
When the browser still reports connectivity, the app retries the session every
10 seconds to recover from transient request failures without waiting for a
browser online event.
An explicit signed-out response or `401/403` from the session endpoint clears the
private offline cache. The public shell starts from its cache immediately and
refreshes in the background; failed asset downloads preserve the previous shell.

On iPhone, open the installed home-screen app while connected, sign in there, and
open each trip you want to keep offline. Then return to the trip list, close the
app, enable airplane mode, and relaunch the same icon. You should see the remembered
account and the saved trip list, with links to downloaded trips. Trip-name search
and paging remain available over saved entries; maps and flight searches,
and edits require connectivity. Clearing website data or
browser storage eviction removes offline availability. The service worker is only
registered by production builds, so `scripts/server` alone does not test it.

## Offline browser regression

Run the production browser regression (WebKit and Chromium, including closing the
browser process and reopening offline) with:

```zsh
cd src/TripPlanner.Web
corepack pnpm exec playwright install webkit chromium
corepack pnpm run test:offline
```

The test serves production assets and deterministic local API fixtures; it does not
contact a real account or database.

## Loading states

Page, map, picker, and list loading states use Fluent UI skeletons that mirror the incoming content: agenda timelines, destination cards with flight separators, compact search options, stay names and addresses, traveller rows, and form controls. Feature-specific skeletons live beside their views; the shared wrapper handles loading announcements and simple map/text placeholders without a generic card fallback. Existing content remains visible during short saves, with disabled controls and status text. Spinners are reserved for long-running flight searches and scheduling operations.
