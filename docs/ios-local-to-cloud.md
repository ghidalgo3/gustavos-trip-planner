# iOS local-to-cloud decisions

Decision record updated November 2, 2026.

This document records the product and architecture decisions from the local-first
iOS discussion. It separates intended behavior from the implementation completed
so far. The older storyboard in [milestone 6](milestone_6.md) remains design
background; it is not evidence that every native feature is implemented.

## 1. Start with trips, not authentication

The app opens on Trips. A person can create, view, edit, and delete device-local
trips without an account or network connection. Signing in must not be a
prerequisite for using features that the device can provide.

Use native capabilities wherever practical: MapKit, reservation tracking, Siri
through App Intents, and calendar integration through EventKit. Ask for system
permissions when the relevant feature is invoked, rather than during an obligatory
first-launch onboarding sequence.

The initial direction is manual reservation records and Siri support before
broader reservation automation. These integrations remain planned.

Local trips initially have only the device user as their traveler. Collaboration
belongs to cloud trips.

## 2. Gate server features at the point of use

Require sign-in when someone chooses a feature that needs the server:

| Feature | Decision |
| --- | --- |
| Invite other Trip Planner users | Requires sign-in and a cloud trip |
| Search for flights | Requires sign-in and a cloud trip |
| Enable MCP integration with agents | Requires sign-in; agents access server-owned trips |
| Native device features and local trip editing | Do not require a Trip Planner account |
| View downloaded cloud trip data offline | Available from the device cache |
| Edit cloud trips offline | Not supported; cloud trips are read-only offline |

Signing in and moving a trip to the cloud are separate decisions. Signing in must
never automatically upload all device trips. New trips default to device storage;
the person explicitly chooses which trips to promote.

Canceling sign-in leaves local work available. Native trip access should not be
blocked by unrelated profile setup. The existing server authorization/onboarding
flow still needs review for complete consistency with this requirement.

## 3. Local persistence and ownership

Use SwiftData for local persistence. Core Data was considered as an alternative;
there is no decision to maintain two persistence implementations.

Disable automatic CloudKit synchronization. Device backups are allowed; backup
does not mean that Trip Planner's server owns the trip or that the trip is shared.

Keep stable trip identifiers across local creation and cloud promotion. Persist
the local data and recovery state before starting network work.

The current foundation uses a versioned SwiftData schema with records containing
encoded trip state. It is not yet a fully modeled SwiftData itinerary graph.

| Trip state | Authority | Device behavior |
| --- | --- | --- |
| Local | Device | Read and edit locally, including offline |
| Promotion pending or outcome uncertain | Transfer not yet resolved | Retain the original data and journal; prevent competing edits |
| Cloud | Server | Display cached data; submit edits online |
| Cloud, offline | Server | Read downloaded data; disable server-dependent mutations |

Cloud trips retain a device cache for responsiveness and offline viewing. A cache
does not become an independently editable local trip.

Promotion is one-way: local → cloud. There is no cloud → local conversion. Signing
out, a failed download, or losing connectivity must not reverse ownership.

## 4. Reuse the snapshot import/export contract

Use the existing version-1 trip snapshot document and its
[pinned schema](schemas/trip-snapshot-v1.schema.json). Do not introduce a separate
native upload format or a separate trip-import route.

The endpoint implementation was renamed from `TripSnapshotEndpoints.cs` to
`TripImportExport.cs`.

| Operation | Route | Purpose |
| --- | --- | --- |
| GET | `/trips/{tripId}/snapshot` | Export/download the canonical snapshot |
| PUT | `/trips/{tripId}/snapshot` | Import a local trip as a new cloud trip |

The iOS client sends the same version-1 document shape used for export. Import is
create-only, not an unrestricted replacement of an existing cloud trip.

The authenticated account becomes the owner. Owner identifiers, permissions,
revisions, ETags, or cached resource values supplied in the document must not
grant authority. Validate supported content before writing relational rows.

### Promotion sequence

1. Persist a pending promotion with stable trip identity and a stable payload.
2. Authenticate if necessary and obtain the person's explicit cloud-storage choice.
3. Upload the version-1 snapshot.
4. Validate and write the supported trip data and import receipt in one database
   transaction.
5. Download the canonical server snapshot.
6. Atomically replace the local record with an account-scoped cloud record and
   clear the completed transfer journal.

The app must distinguish server commitment from successful cache download. Once
the import is known to have committed, a download failure means retry the
download, not restore local editing or create another trip.

### The internal import receipt

The separate `/trip-imports` API and bespoke request DTO were removed. The
`trip_imports` PostgreSQL table currently remains an internal retry receipt.

It is not a staging queue. No background worker later converts its payload into
trip rows. The import store writes supported relational data and the receipt
together during the request.

The trip ID also serves as the retry key for the snapshot endpoint. Current
receipt behavior is:

- First successful import: create the trip and initial party, return 201.
- Identical retry by the same account: return the existing trip with 200.
- Reused identity with different content or conflicting ownership: return 409.
- Retry after the imported trip was deleted: return 410 rather than recreate it.

Retaining the receipt after trip deletion prevents an old request from resurrecting
the trip. Removing the receipt table entirely was not agreed; the simplification
requested was to reuse the snapshot endpoint and schema.

### Current import boundary

The importer currently accepts metadata-only trips, matching the initial native
editor. It does not yet import full destinations, activities, flights,
reservations, additional travelers, or all planning/origin settings.

Unsupported content must be rejected explicitly rather than silently discarded.
Using the full document schema does not mean arbitrary exported itineraries can
already be imported. Full relational mappings remain implementation work.

The existing MCP snapshot read integration follows the renamed endpoint
implementation. A separate MCP import tool has not been added.

## 5. Hide API latency with local presentation

The UI reads from device state instead of waiting for a REST request every time it
renders an object. Cloud writes can take time without blanking the screen.

Keep a confirmed server value separately from the optimistic draft. Persist a
durable pending-write journal containing the operation, account, base value,
draft, and recovery status.

For an ordinary cloud edit:

1. Validate the complete resource locally.
2. Save the draft and pending operation durably.
3. Display the draft immediately with a saving indication.
4. Send the resource update asynchronously with its ETag.
5. On success, replace the confirmed value and clear the pending operation.

Allow at most one pending write per resource. Prevent overlapping edits to that
resource while permitting work on other trips. A slower list refresh must not
overwrite a newer save.

Use complete-resource REST updates, not an endpoint for every property. Grouped
values stay in a form draft until explicit confirmation. Independent, complete,
valid actions may save immediately; independent text saves on blur after
validation, not on every keystroke.

Cloud offline mode preserves navigation, layout, filtering, sorting, scrolling,
and detail viewing. Disable edits and network-only actions. Local trips remain
editable offline.

Use content-shaped skeletons for initial loading. Keep existing content during
short saves; reserve spinners for genuinely long-running operations.

## 6. Failure, uncertainty, and conflicts

A failed response does not always mean the server rejected the write.

| Situation | Required behavior |
| --- | --- |
| Definite rejection | Retain the draft and confirmed value; expose recovery |
| Timeout or lost response | Reconcile by reading server state before repeating a mutation |
| Server already matches the intended edit | Treat the write as completed |
| Server still matches the base | Retry when appropriate using concurrency protection |
| Server differs from both base and draft | Surface a conflict; do not overwrite automatically |
| Import committed but snapshot download failed | Retry download; preserve cloud ownership |

Use ETags and conditional writes to detect concurrent changes. Do not silently
merge arbitrary conflicting resources or repeatedly submit stale drafts.

Recovery states include queued, sending, uncertain, failed, conflict, and
committed-awaiting-download. Pending work must survive app termination.

The initial conflict recovery allows review of the draft and confirmed version,
refresh, and deliberate discard/re-edit. A polished field-by-field merge UI is
not implemented.

## 7. Account isolation and sign-out

Associate cloud caches and pending operations with the authenticated account.

Signing out preserves local trips. Clear ordinary cloud caches while retaining
unresolved journals for recovery with the same account. Do not expose one
account's pending data to another account.

Cancel or invalidate in-flight session work on sign-out. A late response or token
refresh must not restore a signed-out session or repopulate another account's
cache.

## 8. Google and Microsoft sign-in

The desired experience is the Google or Microsoft sign-in page, not a separate
Trip Planner credential form.

The current native buttons initiate provider-specific Azure App Service login
routes (`/.auth/login/google` and `/.auth/login/aad`). Those routes redirect to
the provider and then return to Trip Planner's OAuth flow.

The native app currently uses a system web authentication session, authorization
code flow with PKCE, state validation, and Keychain token storage. Trip Planner
issues the API access token.

There are distinct surfaces that can display Trip Planner's name or domain:

- The system's web authentication permission prompt.
- The server's post-login authorization/consent page.
- A fallback provider-selection page if server authentication is absent.

Direct provider-first authentication was discussed as possible, but no switch to
Google's native SDK, Microsoft's MSAL, or a replacement token-exchange flow was
approved or implemented. That work requires provider registrations, callback
configuration, and backend token validation/session handling. Do not describe
it as a completed button-URL change.

## 9. UI decisions

Preserve the application's established visual design when connecting persistence
and server behavior. The local-first work unnecessarily replaced the trip-list
presentation; that regression was acknowledged. The subsequent card repair was
not an exact restoration of the earlier design.

The current workspace has since evolved to a Reminders-inspired `TripListView`
with My Trips and Invited Trips. This is an implementation observation, not a
reason to reinstate the intermediate card layout.

Agreed UI requirements:

- Use a primary checkmark button to confirm trip creation/editing, rather than
  the visible word “Save.” Keep an accessible action label.
- Remove “Stored on this device” and “You can move this trip to cloud after
  creating it” from the editor.
- Do not label ordinary local list items “On this device.”
- Show an optional cloud icon for cloud trips, requested at the bottom right of
  the list item.
- Tapping the cloud icon opens a popover saying “This trip is stored at” followed
  by the actual, tappable website URL for that trip.
- Link to the website's `/trips/{tripId}` page, not the API snapshot endpoint.
- Keep controls self-explanatory and avoid explanatory storage prose in routine
  flows. Explain irreversible choices and actionable errors where necessary.
- Keep pending-save/conflict recovery available even when normal storage labels
  are removed.

All view files should have previews with state controls. Trip-list previews must
show several trips at once, with varied names and descriptions. Empty remains an
explicit separate state; offline and conflict previews also need multiple trips.
Use isolated preview data and avoid real authentication or network requests.

## 10. Implementation status and remaining work

Completed foundations include SwiftData metadata persistence, optional sign-in,
account-scoped caching, durable writes, optimistic metadata editing, ETag-based
recovery, and metadata-only snapshot promotion. The checkmark editor and cloud
website popover have been implemented.

The following remain planned or require follow-up:

- Full local itinerary, destination, activity, and reservation models/editors.
- Complete import mappings for the shared snapshot graph.
- MapKit, EventKit, Siri/App Intents, and reservation features.
- Server-feature gating across the complete native application.
- The decision and configuration for direct provider-first authentication.
- End-to-end authentication/onboarding and PostgreSQL import verification.
- Review of promotion and recovery controls after the latest list refactor;
  earlier model support does not guarantee those actions remain exposed in UI.

Earlier validation passed an Xcode build, ten Swift persistence/recovery tests,
and eight targeted C# snapshot validation tests. PostgreSQL integration remained
unverified. Those results describe the earlier implementation checkpoint, not a
fresh validation of every later UI change.
