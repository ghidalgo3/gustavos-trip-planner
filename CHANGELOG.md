# Changelog

Significant changes, new features, and bug fixes are recorded here, newest first.
Add entries under **Unreleased**, grouped as **Added**, **Changed**, **Fixed**, or
**Removed**. Describe the effect on users or development workflows; omit routine
formatting and test-only changes. Move entries into a dated release section when
a release is made, using the exact `YYYY.MM.DD.N` tag reported by
`scripts/release`. Keep an empty **Unreleased** section above the released entries
and commit the changelog rollover separately; the tag stays on the deployed
source commit. Failed releases and `--check` runs leave entries unreleased.

## Unreleased

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
