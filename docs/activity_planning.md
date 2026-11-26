# Activity planning

## Plan resources and place search

Activity-planning routes and MCP tools accept a destination ID (for example
`tokyo-jp`, preferred) or its exact saved name (`Tokyo`, case-insensitively) in
`destinationCity`. Reads, replacements, preferences, assessments and proposals
resolve to the same ID; ambiguous names require the ID. A destination with no
saved plan returns HTTP 200 with an initial plan, version 0, ETag `"0"`, and a
planning context version. Initialize it by replacing that complete plan using
those validators; no separate initialization call is needed. A missing destination
returns `destination_not_found` (404), an ambiguous name returns
`destination_ambiguous` (409), and an existing destination whose planning context
cannot be loaded returns `planning_lookup_failed` (503).

Each destination's activity-plan day has an optional `name` of up to 200 characters,
such as **EPCOT Visit**. Names appear with the date in the calendar heading and
its date picker. Open **Day details** to edit the name; existing days save on blur
with saving/error status and Retry. Offline and read-only views retain the same
layout with editing disabled. Names are labels and do not constrain the scheduler or move with
activities. Removing a day removes its name; changing a date does not shift names
by day number.

Names live in `preferences.destinations[].schedule.days[].name` in the trip document
and in the existing activity-plan GET/PUT and MCP contracts. Surrounding whitespace
is trimmed and blank names become `null`. Name autosave replaces the complete last
confirmed plan using its ETag and context version while retaining unrelated local
schedule drafts. A name-only replacement preserves saved assessment/timing and its
staleness, increments the plan version, and makes earlier proposals stale. It does
not refresh evidence or run the scheduler. Plans remain stored as JSONB with no
additional table or column.

Manual activity location searches use Azure Maps Fuzzy Search for venue
names and street addresses (`POI`, `PAD`, and `Addr` indexes). Results remain limited
to six candidates in the destination country and within 50 km of its center.
City and region centroids are excluded from these location searches.
While searching for an activity location, the map shows only numbered search
results matching the list. Select a result from the map or list to use it;
selecting a result or closing the editor restores the saved activity markers.
Map camera changes animate between views, including destination changes. Markers
fade in and out while unchanged markers remain in place. These transitions respect
the device's reduced-motion preference.
After first opening Activities, its map and unsaved editor state remain mounted
while switching sections within the same trip. Returning refreshes destination
and activity data without recreating the map. Fullscreen moves the same map surface
into the dialog, retaining zoom, position, and loaded tiles. Leaving the trip
disposes the map; persistence is in memory, not across page reloads.


When date requirements leave no flight-date pairs, the API identifies the
conflicting windows and stay dates. The flight-search card displays the affected
numbered requirements and can open the editor at the first one.

## Activity selection and daily planning (milestone 3)

Activities has **Ideas** and **Schedule** views. Ideas has independent pill filters
for Considering, Planned, and Not Interested, each with its status icon and count.
All three start enabled. Counts reflect the current search, and enabled statuses
share one list in their original order. Filters remain available offline and in
read-only mode. Map marker numbers stay consistent when filtering the list.
A plan selects activities,
assigns each activity at most once across repeat visits, and orders each day.
Schedule centers a day calendar with an hour rail and time-proportional event blocks.
On wide screens, a searchable activity list sits to its left and the map to its
right; both dividers resize with dragging or keyboard arrows. On smaller screens,
the list and map stack below the calendar and scroll with the page.
Drag an activity from the list onto the calendar to schedule it, move an event
to change its time, or drag its start/end handles to resize it. Timing snaps to
15 minutes, previews before release, and saves the complete versioned plan on
drop. Drag near the calendar's top or bottom to scroll; hover the previous/next
day button to move an event to another visit day. Escape or dropping outside
the calendar cancels the gesture. Failed saves keep the confirmed event and offer
a retry. Touch users drag activities by their dotted handle.
Use previous/next or the date picker to navigate visit days, including empty days.
Activities without timing appear in **Unscheduled**. Tap one, or use **Add event**, to choose
its visit date, start, and end. **Save** submits the complete plan with its ETag and
planning context; **Cancel** discards the editor draft. Moving an event schedules
it exactly once, retains its other restrictions, and validates flight availability
before saving. Overnight events use **Ends next day**. Times use the destination's
time zone, which appears in the calendar toolbar. Saved meals and flights appear
alongside activities. Overlapping events occupy separate columns.

Tap a travel block between activities (or to/from a saved stay) to choose
**Driving** or **Walking**. **Calculate travel time** calls the Azure Maps Route
Matrix API from the browser using its authenticated Maps SAS. Estimates use
historical traffic without a specific departure time and round up to whole minutes.
Users can also enter a travel allowance directly. Changing mode clears the draft
allowance. **Save** updates the complete plan with a leg-specific mode and ISO 8601
duration; individual choices take precedence over the day's default mode.
Failed calculations retain the allowance and can be retried. **View route** previews
the selected mode on the map without saving the draft. No standalone transportation form appears on Overview.

The calendar remains available offline with date navigation, scrolling, event
inspection, and disabled editing/calculation controls. Save failures retain the
draft for correction or refresh; pending saves prevent overlapping writes. Day
names remain editable on blur under **Day details**, using a complete versioned
plan update. Scheduling proposals, detailed assessments, and advanced restrictions
remain available through REST/MCP rather than a second planning form below the
calendar. Existing saved restrictions are preserved when editing event timing.

Overview destination cards let you edit dates by tapping the date range. Their
utilization bars use saved assessments of travel, meals, activities, and reserved
slack; gaps between scheduled events remain free time.

On tablets and laptops (768px and wider), drag the divider between the activity
column and the map to resize them. Focus the divider and use the arrow keys for
keyboard resizing; Home and End move to the minimum and maximum column sizes.
New destinations automatically resolve and save their IANA timezone from the city's
coordinates using the bundled [GeoTimeZone boundary data](https://github.com/mattjohnsonpint/GeoTimeZone).
Normal city lookups work offline and require no Azure Maps permission or user input.
Azure Maps timezone lookup remains a fallback when no recognized civil zone is found
in the local data; synthetic ocean offsets are not used as city timezones. API clients
can omit `timeZone`; repeat visits reuse the saved city timezone. Older destinations
with a missing timezone also resolve it in destination and planning responses without
mutating shared data during a read. Destination replacement resolves an omitted zone
before saving, and saved plans missing a zone inherit the city's zone when loaded.
The Schedule view displays the resolved city timezone in the calendar toolbar;
it does not ask users to choose a timezone. Explicit API overrides remain supported.
If both lookup sources fail, the zone remains unknown with a retry explanation;
manual planning remains available and calendar entries need known timing rather than a guessed zone.
The event editor changes dates, start/end times, and transportation. Must-do,
relative-order, meal, opening-hours, and availability restrictions remain supported
by REST/MCP and are preserved by web timing edits. Conflicting plans can be saved with explanations.
Profile interests are private; trip and destination interests are shared. Preference
scoring combines all travellers with equal weight and narrower instructions take
precedence. Agent-proposed timing rules and flight-derived availability require
explicit acceptance.

The activity map stays visible in Ideas and Schedule. Ideas has a search icon beside **Add activity**. Opening it replaces the heading
and actions with a focused search field and an X button. The filter searches all
activity field values, works offline, and stays active until X clears and closes
it. Map markers and their numbering remain unchanged.
On phones, Ideas and Schedule scroll with the page, and activity editors scroll
through their action buttons. The calendar's hour grid scrolls independently. Overview keeps destination names and dates above
the card actions. Action results use dismissible Fluent UI toasts anchored at the viewport’s top-right, above drawers and dialogs without moving when focus changes: successes close
automatically, while failures stay visible for review. Field validation and
loading failures remain beside the relevant content.
Dismissing a focused toast restores focus to its previous control so an open
dialog remains accessible for retrying the action.

Manual planning and deterministic assessments need no AI or provider credentials.
Unknown durations, travel and hours stay provisional with explicit assumptions.
Durable proposal jobs use OR-Tools CP-SAT, publish partial results, and return
reviewable alternatives and incremental changes. Neither research nor optimization
changes the saved plan. Plan replacements require both `If-Match` and the returned
input `contextVersion`; stale proposals must be regenerated. Existing activities marked Yes
start selected and unscheduled. All new shared mutations use the Activity
Log. Migration `0011_ActivityPlanning.sql` adds the documents, jobs, evidence,
concurrency counters, reference maintenance, and hashed calendar tokens.

Calendar subscriptions contain only accepted, dated activities. Each member can
create and revoke their own bearer URL. The URL is returned once at creation and
is omitted from listings and logs. Removing a member permanently revokes their
subscriptions. Evidence refreshes mark saved timing stale; calendar events retain
the accepted timing until the plan is saved again.

Set up routing and calendar publication before releasing this milestone:

```zsh
./scripts/buildout                 # adds Azure Maps route-read and timezone-read permissions
./scripts/server                  # reads the optional key for local development
```

Azure Maps provides walking and road travel; road defaults to taxi/rideshare.
Migration `0014` converts old transit settings to walking, clears transit duration
overrides and cached transit routes, and invalidates old proposals. Saved calendar
times remain unchanged until revised timing is accepted.
Automatic transport chooses the shortest supported walking or driving duration
for each leg at its scheduled departure, including accommodation connections.
Both modes are requested during routing enrichment; preference scores only break
same-duration ties. Fresh provider evidence takes precedence over an unverified
estimate for a missing alternative. Until evidence is available, distance-based
estimates are explicitly provisional. `fastest` is the default day transport mode;
legacy day-level `walking` settings use the same automatic behavior. Explicit
per-leg walking/driving/taxi choices and manual durations remain in force; a
whole-day driving choice still uses driving for the day. Public transit is not
supported. Language-model research and preference interpretation are performed by the user’s agent. The server uses supplied activity metadata and explicit scheduling restrictions.

The MCP tools reuse REST validation, authorization and services. Read tools need
`tripplanner.read`; persisted assessments/proposals, replacements and subscription
management need `tripplanner.write` and the applicable trip permission. Profile
scope always means the authenticated user. Use a fresh request UUID for new work,
reuse it only to retry identical work, poll with `get_operation`, read the proposal,
and apply the complete chosen plan with its current ETag and context version.
Calendar URLs are returned only by `create_calendar_subscription`.

See [milestone 3](necessary_slop/milestone_3.md) for contracts, solver semantics, provider
limits, verification commands, and live smoke-test steps.

## Duration editing

The activity editor uses a duration slider from 30 minutes to 12 hours in half-hour steps, with a readable value and keyboard controls. Unknown durations can be set to 30 minutes or chosen with the slider, and **Clear duration** restores an unknown value. Existing researched durations, including values outside those increments, remain unchanged until edited. API durations continue using ISO 8601.
