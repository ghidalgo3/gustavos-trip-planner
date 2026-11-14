# Airport catalog

ReadView retrieved 2026-09-20. Passenger airports with scheduled service and IATA codes
from [OurAirports](https://ourairports.com/data/) (public domain), joined by IATA code
to IANA time zones from [airportsdata](https://github.com/mborsetti/airportsdata)
(MIT; see airportsdata-LICENSE). Entries without a matching time zone are excluded.

Sources:
- https://davidmegginson.github.io/ourairports-data/airports.csv
- https://raw.githubusercontent.com/mborsetti/airportsdata/main/airportsdata/airports.csv

Local builds bundle `airports.json`. Every release downloads fresh source CSVs via
`scripts/release-tasks/refresh-airports.zsh`, joins IATA codes with time zones, and
embeds the validated result in the image using a compressed BuildKit secret mount,
decompressed and checksum-verified before compilation. The files
remain in the invocation's temporary directory; the release checkout stays clean.
The refreshed set includes non-closed IATA airports with scheduled service, known coordinates, and
time zones. A result below 1,000 entries aborts the refresh. Startup synchronizes
this snapshot into PostgreSQL, preserving IDs and marking missing airports
inactive rather than deleting them. No runtime provider request or API key is
needed. Airport metadata is not a guarantee of current routes.
Home-airport suggestions prefer a large airport within 75 km; otherwise they use the
nearest scheduled passenger airport within 250 km. Users can change this suggestion.

Metropolitan groups in `AirportCatalog` explicitly include airports outside the
administrative city (for example, Tokyo includes HND and NRT). Other cities use
matching catalog city names. Home-city profile selection also checks geographic
proximity and falls back to a nearby major airport when needed. Multi-airport
cities require a preferred airport in the profile, while flight searches retain
the entire city group. Exact airport-code selections remain specific. Curated
groups should be reviewed alongside catalog refreshes.
