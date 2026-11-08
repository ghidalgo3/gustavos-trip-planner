# iOS local trips and cloud promotion

Local trips work without sign-in and are stored on-device using SwiftData.
Signing in enables cloud trips and an explicit move of a local trip to the server.

Promotion submits the current [trip document](../trip_document.md) through
`PUT /trips/{tripId}/document`. The authenticated account becomes the owner.
The trip ID is the durable retry key; the server never overwrites an existing trip.
Only metadata-only import is supported, and richer content is rejected rather than lost.

A persisted pending-write journal retains the trip identity and complete draft so
an uncertain upload can be reconciled without creating another trip. After a
successful import, the client downloads `GET /trips/{tripId}/document`; a download
failure must not make the promoted trip locally editable again. Local pending writes
use only the current format and endpoint.

Cloud edits use resource ETags and complete resource updates. Cached cloud content
remains readable offline, with edits disabled. Refresh is required after a conflict;
requests are not blindly replayed with a newer validator. Sign-out resets account
state and pending feature work while preserving local trips.

Use `swift test --package-path src/TripPlanner.iOS` for core storage, authentication,
document decoding, promotion, and concurrency coverage. Build the Xcode application
to validate the SwiftUI features and previews.
