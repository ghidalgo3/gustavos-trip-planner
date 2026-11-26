# PostgreSQL database

The API requires `ConnectionStrings:TripPlanner`. Docker Compose supplies a local PostgreSQL connection string with development-only password authentication. In Azure, `buildout` provisions an Azure Database for PostgreSQL Flexible Server with password authentication disabled and assigns the App Service managed identity as its Microsoft Entra administrator. `release` supplies a passwordless TLS connection string and enables managed-identity token acquisition. Npgsql periodically refreshes the database access token through `Azure.Identity`.

At startup, the API acquires a PostgreSQL advisory transaction lock, creates the `gustavo_planner` schema when needed, then creates `gustavo_planner.schema_migrations` and loads and sorts the `.sql` files in `src/TripPlanner.Api/migrations`. Application connections use `gustavo_planner` as their search path, so all application tables and indexes live in that schema. Migration filenames use `0001_MigrationName.sql`; the four-digit prefix is the unique migration version. Applied versions and filenames are recorded in `gustavo_planner.schema_migrations`, and startup fails if an applied version has since been renamed. Keep the filename of each applied migration, including `0018_SnapshotModificationTime.sql`. New migration files are copied into build and publish output automatically.

Run `scripts/drop_db` to permanently drop the production `gustavo_planner` schema. It authenticates with the signed-in user's Microsoft Entra token and requires typing `drop gustavo_planner` before executing the drop. The API recreates the schema and its objects at its next startup, then restores contributor table grants and default privileges. Dropping the schema removes those grants from the old objects; role membership alone does not grant access to tables created afterward.

Migration `0001_CreateUsers.sql` enables PostGIS and creates `users`, `trips`, and `parties`. Each application user has a unique UUID and a unique, lowercase email address. Signing in with another provider that supplies the same email reuses the user ID and adds that provider to the row's comma-separated provider list. The table stores one required display name, a display name for the home city, its location as `geography(Point, 4326)`, and an array of preferred airline codes. Provider subjects, issuer, split given/family names, preferred username, provider verification flags, profile-image URLs, locale, hosted domain, tenant ID, and object ID are not persisted.

The same migration installs pg_cron in the configured `tripplanner` database and schedules `tripplanner-purge-fares` hourly. It removes completed or abandoned `fare_searches` rows six hours after retrieval or creation; rows assigned to an active operation are retained. Azure infrastructure allowlists and preloads pg_cron and sets `cron.database_name` to `tripplanner`. `scripts/buildout` restarts PostgreSQL when a server setting is pending restart, so pg_cron is ready before application migrations run. Editing an already applied `0001` file does not rerun it: databases created before these changes need the updated schema applied during a reset or the new SQL applied separately. The local development database received the `preferred_airlines` and `preferred_airport` columns without dropping its data. Existing cloud databases also need `preferred_airport` applied or a development schema reset; this code change does not deploy infrastructure.

Infrastructure deployment maps the App Service managed identity and a dedicated PostgreSQL provisioning identity into Entra authentication. It creates the `gustavo_planner_contributor` PostgreSQL role and maps the Key Vault operator's Entra object ID to the `gustavo_hidalgo` database login, then grants that login contributor membership. The role can connect to `tripplanner`, create objects in `gustavo_planner`, and read and modify its tables and sequences. `scripts/setup` installs Homebrew's `libpq` client, which provides `psql` for database maintenance.

## Copy production data locally

Run these commands from the repository root after signing in with `az login`.
They use the PostgreSQL image from the local Docker development stack.

```zsh
copy_name="$(scripts/copy_production_db --temporary-firewall)"
scripts/server --detached --database "$copy_name"
```

The copy command uses Microsoft Entra authentication and verifies the PostgreSQL
server’s TLS certificate. It reads the production application schema and restores
it into a new local database. The archive excludes OAuth records, calendar
subscription tokens, and background jobs and their operation records. The copy
still contains real accounts and trip details. Keep it in local Docker and treat
audit artifacts as private.

Use `--temporary-firewall` when your public IPv4 needs access. The command creates
a rule for that address and removes it when the command exits. If Azure already
allows the address, run `scripts/copy_production_db` directly. Your Azure login
needs read access to the application schema and permission to manage the temporary
rule if you use that option.

The command prints the new database name on success. Use
`--database tripplanner_copy_NAME` to choose a name at copy time. The restore
publishes the copy only after verification and rejects an existing name. Run
`scripts/server --detached` to switch the app back to the regular development
database. Both databases are stored in the local PostgreSQL volume.

## Trip resources

A trip's editable fields are its name, description, and optional free-form JSON object `constraints` (default `{}`). `/trips` and `/trips/{tripId}` use the authenticated user's identity; Travellers can read shared trips; Planners and the owner can edit trip constraints, destinations, activities, and flight plans. Only the owner can delete the trip or manage party membership and roles. The trip response includes `canPlan` for the current user. `PUT` replaces all editable fields; omitting constraints resets them to `{}`. The existing `/user/{userId}/trips` routes remain compatibility aliases for the current GUI and preserve constraints on metadata-only updates. A new trip and its initial one-person party are inserted in one transaction.

Destinations are Point GeoJSON Features at `/trips/{tripId}/destinations/{destinationCity}`, with their own `properties.constraints` object. Destination stays and activities belong to that city resource. Flight planning is independent at `/trips/{tripId}/flights`; its search document lives in separate `flight_constraints` storage and never appears as trip constraints. Migration `0005` preserves existing flight-search documents in that column. The trip page now starts on Overview; trip-wide date and flexibility controls are a follow-up.

## User records and avatars

`GET /user` reads the authenticated ASP.NET principal and asks `IPlannerDb` for the user. The database creates the row only when the provider identity is new. The response includes `completedOnboarding`, which becomes true after a home-city geographic point has been stored. Other requests do not write to `users`.

`GET /user/avatar` uses the access token in the current authenticated session to retrieve the profile image from Google UserInfo or Microsoft Graph. The API returns the image without storing its URL or contents; the client falls back to the user's initials when the provider has no image. Microsoft sign-in requests the delegated `User.Read` scope for this lookup.
