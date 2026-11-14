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

### Added

- A public Notices page linked from the footer shows required attributions and
  links to the retained third-party software license notices.
- Trip headers show dates and unique, borderless country flags from Flagpack.
  Destination cards and activity tabs show matching City Icons, including while offline.
- Trip list cards also show unique country flags beside their dates, online and offline.

### Removed

- Removed the Transportation editor from the web trip overview.

### Changed

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
