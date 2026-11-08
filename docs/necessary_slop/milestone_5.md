# Milestone 5: Complete trip documents

The maintained contract and implementation guide is [Trip Document](../trip_document.md),
with the [version 1 schema](../schemas/trip-document-v1.schema.json).

The server exposes one portable file model through GET/PUT `/trips/{tripId}/document`.
Its itinerary is one calendar of events and tasks, including explicit hotel stays.
Web and iOS clients use this format. PostgreSQL supplies a consistent trip read;
focused REST APIs update whole resources using their ETags and context validators.
Optional validators are direct properties of their entities and editable sections;
it contains no API routes or response bodies.
Assessments are separate API features. The web caches viewed API results outside
the portable file for read-only offline access. Metadata-only imports never
silently discard unsupported trip content.

See [before.json](../before.json) and [after.json](../after.json) for the captured
Japan trip comparison. The prior file format is no longer implemented.
