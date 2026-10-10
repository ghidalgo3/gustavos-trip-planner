CREATE TABLE destination_places (
    trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    city_id text NOT NULL,
    name text NOT NULL,
    country_code text NOT NULL,
    time_zone text NOT NULL,
    center geography(Point, 4326) NOT NULL,
    PRIMARY KEY (trip_id, city_id)
);

CREATE TABLE activities (
    id uuid PRIMARY KEY,
    trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    city_id text NOT NULL,
    location geography(Point, 4326),
    properties jsonb NOT NULL,
    source_operation_id uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (trip_id, city_id) REFERENCES destination_places(trip_id, city_id),
    CONSTRAINT activities_properties_object CHECK (jsonb_typeof(properties) = 'object')
);
CREATE INDEX activities_trip_city_created_idx ON activities(trip_id, city_id, created_at, id);
CREATE UNIQUE INDEX activities_source_candidate_idx ON activities(source_operation_id, id) WHERE source_operation_id IS NOT NULL;

CREATE TABLE activity_jobs (
    operation_id uuid PRIMARY KEY REFERENCES operations(id) ON DELETE CASCADE,
    trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    city_id text NOT NULL,
    context_version text NOT NULL,
    selected_at timestamptz NOT NULL,
    input text NOT NULL,
    image bytea,
    image_sha256 text,
    image_mime_type text,
    result jsonb,
    error text,
    lease_id uuid,
    lease_expires_at timestamptz,
    attempts integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (trip_id, city_id) REFERENCES destination_places(trip_id, city_id)
);
CREATE INDEX activity_jobs_queue_idx ON activity_jobs(created_at, operation_id)
    WHERE result IS NULL AND error IS NULL;
