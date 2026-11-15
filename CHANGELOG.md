# Changelog

Significant changes, new features, and bug fixes are recorded here, newest first.
Add entries under **Unreleased**, grouped as **Added**, **Changed**, **Fixed**, or
**Removed**. Describe the effect on users or development workflows; omit routine
formatting and test-only changes. After a successful release, `scripts/release`
automatically moves entries into a section named with its exact `YYYY.MM.DD.N`
tag, keeps an empty **Unreleased** section above it, and commits the rollover
separately. The tag stays on the deployed source commit. Failed releases and
`--check` runs leave entries unreleased.

## Unreleased

## 2026.11.15.1

### Changed

- Stay and activity place searches share full-width numbered result buttons and
  loading placeholders. Stay search results also appear as matching, selectable
  pins on the drawer map.
- Activity status groups are replaced by independent pill filters with icons and
  search-aware counts, keeping matching activities in one list, including offline.
- Activity statuses display as Considering, Planned, and Not Interested, with
  bookmark, calendar-check, and minus-circle icons; the delete menu action is Remove.
- Removed the page-background gradient and updated dark mode with a navy canvas,
  slate surfaces, brighter blue accents, and coordinated drawer and menu colors.
- Add and create buttons consistently display a plus icon, including Add activity.
- Activity destination tabs use fixed-width cards with shadows and a highlighted
  selected state, with matching loading placeholders.
- Destination tab dates show years only when the trip spans multiple calendar years.
- Ideas and Plan use filled, circular tabs with matching loading placeholders.
- The activity map is shorter on phones, leaving more room for activities below it.
- Removed the map visibility toggle and added local activity-list search, available
  while offline and in read-only mode. A search icon opens a field in place of the
  heading and Add activity button; it filters all activity fields until dismissed
  with X.
- Activity kinds use the preferred-airlines layout, with removable tags above a
  separate search box.
- Breadcrumbs replace trip section tabs and return to Overview from each subpage.
  Overview opens activities from destination cards, flights from itinerary links,
  and sharing controls from a Share button at the top right.

### Fixed

- Activity status filters stay on one horizontally scrollable row at every width,
  with no visible scrollbar.
- Activity status menus highlight the current status without a selection checkmark
  and align status and Remove icons in a consistent column.
- Search fields share a minimum 16px text size at every viewport width to prevent
  Safari focus zoom. The activity-search dismiss button has a wider tap target.
- Opening activity search preserves card positions, and header controls align with
  card edges beside the map divider, including when the list has a scrollbar.
- Destination cards scroll horizontally without a visible scrollbar.
- Breadcrumb labels have consistent spacing around separators, including the
  current page.

## 2026.11.14.1

### Fixed

- Clickable trip, destination, activity, flight, and stay cards share border-only
  hover feedback across their full surfaces, with independent feedback for inner
  controls. Activity names no longer highlight as separate buttons.
- Outline and transparent buttons, including destination date selectors, now
  highlight their full background on hover.
- Muse consent now shows an approval or cancellation result with **Return to Muse**,
  avoiding a blocked cross-site form redirect that could leave **Allow access**
  appearing unresponsive.

### Added

- Muse can connect to the MCP server as public OAuth client `muse` with S256 PKCE
  and refresh tokens, alongside ChatGPT. Connected agents revokes access for both,
  and Muse changes appear under the MCP Activity Log filter.
- The profile page lists MCP server and OAuth discovery URLs for connecting an agent.
- A public Notices page linked from the footer shows required attributions and
  links to the retained third-party software license notices.
- Trip headers show dates and unique, borderless country flags from Flagpack.
  Destination cards and activity tabs show matching City Icons, including while offline.
- Trip list cards also show unique country flags beside their dates, online and offline.

### Removed

- Removed the Transportation editor from the web trip overview.

### Changed

- Destination map changes pan and zoom together, zooming out only far enough to
  fit both endpoint views, using a 1.5-second sine ease-in-out animation.
- Flight searches stay disabled for past destination dates, with shorter warnings
  and no Overview shortcut. Removed the flight selection count.
- Simplified destination forms to a city search and calendar, removing explanatory
  text and hiding flight date flexibility controls.
- Simplified the web flight planner by removing introductory text and traveler
  headings, and placing **Find flights** beside **Clear selections**.
- The profile Activity Log uses compact rows, loads five entries at a time, and
  filters changes by API or MCP.
- Offline notices appear only after 30 seconds and use one compact status line
  with a Retry button. Editing is disabled immediately when offline.
- Replaced the web activity-plan accordion and planning forms with a day calendar.
  Tap events to edit their dates/times and travel blocks to choose Driving or
  Walking, calculate Azure Maps travel time, and save the connection.
- Individual transportation choices now override a day-wide Driving default.
- Activity planning decisions now use Yes, No, and Maybe. New activities start at
  Maybe; existing selections and schedules are preserved when stored states are
  renamed.
- Trip overview destination cards highlight on hover and open that destination's
  activities when clicked, tapped, or activated with the keyboard.

## 2026.11.13.3

### Changed

- Successful releases automatically version and commit the changelog rollover,
  preserving the release tag on the deployed source commit.

### Fixed

- MCP location research now requires independent web coordinate searches after
  failed, ambiguous or inconsistent geocoding, with saved sources, precision and
  address/coordinate read-back verification before reporting completion.
- Geocoding provider errors direct assistants to independent research instead of
  retrying the failed lookup; unresolved venues require documented alternatives.

## 2026.11.13.2

### Added

- Transportation FeatureCollections with notes, referenced or inline endpoints,
  and ordered train/metro directions with optional route geometry.
- Independent trip-scoped hotels, persisted airports refreshed at release time,
  and individual REST/MCP resources with concurrency checks.
- Database-enforced endpoint references, snapshot-on-delete behavior, and stale
  route tracking when linked locations move.

### Changed

- Replaced the trip-wide travel collection with individual transportation
  resources; updated web/iOS document adapters and hotel selection contracts.

## 2026.11.13.1

### Added

- Activity-kind autocomplete reuses labels from your own trips, with searchable
  REST and MCP lists of existing labels.
- Started this changelog and documented how to use Travel connections.

### Changed

- Activity editing uses a mobile-friendly kind TagPicker and clearer activity-name
  and place-search labels.
- Activity cards and details display kinds as wrapping tags.
- Activity kinds accept custom text labels across the API, web, iOS, and MCP tools.
- Releases require a clean Git checkout and create an annotated `YYYY.MM.DD.N`
  tag after deployment verification, with a daily sequence starting at 1.

### Fixed

- Changing an activity's state from its card menu no longer opens the edit drawer.

## Existing feature baseline — 2026-11-13

This is a curated snapshot of changes already present when the changelog started,
not a release record or a complete reconstruction of earlier history.

### Added

- Trip, destination, repeat-visit, accommodation, and activity planning, with
  shared travel parties and permissions.
- Flight searches, individual-leg selection, booking status, and review of saved
  selections affected by itinerary changes.
- Activity agendas, route views, scheduling assessments and optimization,
  editable day names, and separate activity descriptions and planner notes.
- Travel connections for manually recording journeys between home, airports,
  visits, and activities, including transport, departure times, and allowances.
- Account-scoped offline access to downloaded trips and saved flights in the web
  app, with editing disabled while offline.
- MCP planning context, address geocoding, and resource tools for connected
  agents to research and maintain trips.
- An iOS app with trip editing and trip-detail design prototypes.

### Changed

- Consolidated portable trip data into a versioned document containing people,
  shared places, itinerary events and tasks, and editable preferences.
- Standardized wire dates, clock times, timestamps, and elapsed durations on
  ISO 8601, and protected resource updates with concurrency validators.
- Centralized map access behind client interfaces and introduced content-specific
  loading skeletons across the web app.
- Moved release orchestration to a Task dependency graph for testing, building,
  deploying, and verification.

### Fixed

- Activity planning resolves saved destination IDs or exact names consistently,
  supplies an initial plan when none is saved, and distinguishes missing,
  ambiguous, and temporarily unavailable planning contexts.
- Destination date validation prevents overlapping visits while allowing a
  shared arrival/departure day, including during concurrent updates.
- Offline startup preserves the remembered account and saved trip list, and
  failed app-shell refreshes retain the previous cached shell.
