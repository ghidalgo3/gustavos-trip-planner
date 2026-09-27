-- PostGIS is shared infrastructure in public. Its installation needs public
-- first in the search path; application tables below use gustavo_planner.
SET LOCAL search_path TO public;
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;
SET LOCAL search_path TO gustavo_planner, public;

CREATE TABLE users (
    id uuid,
    provider text NOT NULL,
    email text NOT NULL,
    display_name text NOT NULL,
    home_city_name text,
    home_city_location geography(Point, 4326),
    preferred_airlines text[] NOT NULL DEFAULT '{}',
    "FeatureFlags" text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT users_id_primary_key PRIMARY KEY (id),
    CONSTRAINT users_email_unique UNIQUE (email),
    CONSTRAINT users_email_normalized CHECK (email = lower(btrim(email))),
    CONSTRAINT users_provider_supported CHECK (
        provider ~ '^(google|microsoft)(,(google|microsoft))*$'
    ),
    CONSTRAINT users_feature_flags_valid CHECK (
        "FeatureFlags" = '' OR "FeatureFlags" ~ '^[A-Za-z][A-Za-z0-9_-]*(,[A-Za-z][A-Za-z0-9_-]*)*$'
    ),
    CONSTRAINT users_preferred_airlines_valid CHECK (
        array_position(preferred_airlines, NULL) IS NULL
        AND array_length(preferred_airlines, 1) <= 20
    )
);

CREATE INDEX users_home_city_location_idx
    ON users USING gist (home_city_location)
    WHERE home_city_location IS NOT NULL;

CREATE TABLE trips (
    id uuid,
    owner_user_id uuid NOT NULL,
    name text NOT NULL,
    description text NOT NULL DEFAULT '',
    constraints jsonb NOT NULL DEFAULT '{}'::jsonb,
    selected_flights jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT trips_id_primary_key PRIMARY KEY (id),
    CONSTRAINT trips_owner_user_id_foreign_key
        FOREIGN KEY (owner_user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT trips_name_not_blank CHECK (name <> '' AND name = btrim(name)),
    CONSTRAINT trips_name_length CHECK (char_length(name) <= 200),
    CONSTRAINT trips_description_length CHECK (char_length(description) <= 4000),
    CONSTRAINT trips_constraints_object CHECK (jsonb_typeof(constraints) = 'object'),
    CONSTRAINT trips_selected_flights_object CHECK (jsonb_typeof(selected_flights) = 'object')
);

CREATE INDEX trips_owner_user_id_idx ON trips (owner_user_id, updated_at DESC);

CREATE TABLE parties (
    id uuid,
    trip_id uuid NOT NULL,
    user_ids uuid[] NOT NULL,
    CONSTRAINT parties_id_primary_key PRIMARY KEY (id),
    CONSTRAINT parties_trip_id_foreign_key
        FOREIGN KEY (trip_id) REFERENCES trips (id) ON DELETE CASCADE,
    CONSTRAINT parties_has_users CHECK (cardinality(user_ids) > 0)
);

CREATE INDEX parties_trip_id_idx ON parties (trip_id);

CREATE TABLE operations (
    id uuid,
    user_id uuid NOT NULL,
    resource_id uuid,
    type text NOT NULL,
    status text NOT NULL,
    items integer NOT NULL,
    completed_items integer NOT NULL DEFAULT 0,
    failed_items integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT operations_id_primary_key PRIMARY KEY (id),
    CONSTRAINT operations_user_id_foreign_key
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT operations_type_not_blank CHECK (type <> '' AND type = btrim(type)),
    CONSTRAINT operations_status_supported
        CHECK (status IN ('pending', 'InProgress', 'Completed', 'Failed')),
    CONSTRAINT operations_item_counts_valid CHECK (
        items >= 0
        AND completed_items >= 0
        AND failed_items >= 0
        AND completed_items + failed_items <= items
    )
);

CREATE INDEX operations_user_created_at_idx
    ON operations (user_id, created_at DESC, id DESC);
CREATE INDEX operations_user_type_created_at_idx
    ON operations (user_id, type, created_at DESC, id DESC);

CREATE TABLE fare_searches (
    cache_key text,
    request jsonb NOT NULL,
    response jsonb,
    fetched_at timestamptz,
    expires_at timestamptz,
    operation_id uuid,
    lease_id uuid,
    lease_expires_at timestamptz,
    attempts integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fare_searches_cache_key_primary_key PRIMARY KEY (cache_key),
    CONSTRAINT fare_searches_operation_id_foreign_key
        FOREIGN KEY (operation_id) REFERENCES operations (id) ON DELETE SET NULL,
    CONSTRAINT fare_searches_attempts_valid CHECK (attempts >= 0),
    CONSTRAINT fare_searches_response_dates_consistent CHECK (
        (response IS NULL AND fetched_at IS NULL AND expires_at IS NULL)
        OR (response IS NOT NULL AND fetched_at IS NOT NULL AND expires_at IS NOT NULL)
    )
);

CREATE INDEX fare_searches_queue_idx
    ON fare_searches (created_at, cache_key)
    WHERE operation_id IS NOT NULL;

CREATE INDEX fare_searches_purge_idx
    ON fare_searches (COALESCE(fetched_at, created_at))
    WHERE operation_id IS NULL;

CREATE TABLE trip_form_jobs (
    operation_id uuid PRIMARY KEY REFERENCES operations(id) ON DELETE CASCADE,
    input text NOT NULL,
    draft jsonb NOT NULL,
    proposal jsonb,
    error text,
    lease_id uuid,
    lease_expires_at timestamptz,
    attempts integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT trip_form_jobs_attempts_valid CHECK (attempts >= 0)
);

CREATE INDEX trip_form_jobs_queue_idx ON trip_form_jobs (created_at, operation_id)
    WHERE proposal IS NULL AND error IS NULL;

-- pg_cron metadata lives in one database per server. Isolated test databases
-- share the server but must not attempt to install the extension themselves.
DO $$
BEGIN
    IF current_database() = current_setting('cron.database_name', true) THEN
        CREATE EXTENSION IF NOT EXISTS pg_cron;
        PERFORM cron.schedule(
            'tripplanner-purge-fares',
            '0 * * * *',
            $job$DELETE FROM gustavo_planner.fare_searches
                 WHERE operation_id IS NULL
                   AND COALESCE(fetched_at, created_at) < now() - interval '6 hours'$job$
        );
    END IF;
END;
$$;
