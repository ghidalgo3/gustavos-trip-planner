# Airport catalog

Snapshot retrieved 2026-09-20. Passenger airports with scheduled service and IATA codes
from [OurAirports](https://ourairports.com/data/) (public domain), joined by IATA code
to IANA time zones from [airportsdata](https://github.com/mborsetti/airportsdata)
(MIT; see airportsdata-LICENSE). Entries without a matching time zone are excluded.

Sources:
- https://davidmegginson.github.io/ourairports-data/airports.csv
- https://raw.githubusercontent.com/mborsetti/airportsdata/main/airportsdata/airports.csv

airports.json is bundled into the API. No runtime network request or API key is needed.
Refresh this snapshot periodically; airport metadata is not a guarantee of current routes.
Home-airport suggestions prefer a large airport within 75 km; otherwise they use the
nearest scheduled passenger airport within 250 km. Users can change this suggestion.
