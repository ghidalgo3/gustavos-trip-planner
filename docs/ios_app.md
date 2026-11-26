# iOS application

Open `src/TripPlanner.iOS/TripPlanner.iOS.xcodeproj` in Xcode, select the
`TripPlanner.iOS` scheme and an iPhone simulator, and Run (Cmd-R). The existing
project targets iOS 27.0 or later; the prototype uses the installed Xcode toolchain
and has no external packages. A simulator build does not require a signing team.

The app opens on **Trips** without requiring sign-in. Trip names, descriptions,
and dates are persisted locally with SwiftData. Sign-in enables cloud trip access
and an explicit, one-way move to cloud storage. Cloud edits use cached content,
optimistic saves, ETags, and a durable pending-write journal; cloud trips are
read-only offline. Selecting a cloud trip shows destinations from its server
document, with cached data available offline. Online planners can add an
Apple Maps city, change an existing destination city, and edit stay dates. City
replacement preserves the destination ID and planning constraints, keeping its
activities and visits attached. Dates and city changes use separate resource
updates with the ETags captured in the editing document. Save closes the editor
immediately and displays the pending draft while the request continues, including
after navigation. Success commits a refreshed server document; failure asks the
user to refresh destinations before editing again. Pending writes prevent another
destination write to that trip until completion. Shared services are owned by
`AppDependencies`: `AppModel` handles session and trip-level state, while a typed
`ResourceStore` owns optimistic drafts and pending operations across navigation.
`DestinationsModel` handles destination loading, MapKit search, and save requests.
The resource store is reset at sign-out, cancelling pending work and ignoring late
responses from the previous session. Local destination edits are stored on the
current device. Apple Maps search requires connectivity.

The destinations list shows a transportation card between consecutive stops.
Open **Compare options** to view MapKit driving and walking alternatives, or a
public transit ETA with a link to directions in Apple Maps. Cloud planners can
run the existing trip-wide flight search from the sheet. The sheet shows results
for the selected pair of stays and draws illustrative great-circle arcs between
each flight segment’s airports. Selecting a route or flight highlights it in
the sheet for comparison. Saved flights appear in the destination timeline from
the cached or live trip document, including arrival and departure flights.
**Edit → Remove destination** removes a local stop or, for a cloud trip, the
city and all its stays and activities after confirmation.

In Debug builds, filter the Xcode console for the `HTTP` log category to see
request and response pairs for the trip API and OAuth token exchange. Each pair
shares a short ID and includes the status, duration, and byte counts. To diagnose
destination removal, look for the DELETE followed by the document GET. Request
headers, query strings, and payload contents are omitted from the HTTP log.

Cloud promotion uses `PUT /trips/{tripId}/document` with the portable version-1
document used by GET export. Imports currently accept metadata-only
trips and reject unsupported itinerary content. An internal import receipt makes
retries safe; there is no separate `/trip-imports` route.

This is a SwiftUI storyboard, rather than an Interface Builder `.storyboard`
file. Open `ContentView.swift` or a file under `TripPlanner.iOS/Storyboard`, show
the Xcode Canvas (**Editor → Canvas**), and select one of its named `#Preview`
scenes. The storyboard remains available for design review. See
[milestone 6’s screen map and review guide](necessary_slop/milestone_6.md) for the design
decisions, walkthrough, and phase 2 boundary.

```zsh
xcodebuild -project src/TripPlanner.iOS/TripPlanner.iOS.xcodeproj \
  -scheme TripPlanner.iOS -configuration Debug -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath /tmp/tripplanner-ios-build CODE_SIGNING_ALLOWED=NO build
```
