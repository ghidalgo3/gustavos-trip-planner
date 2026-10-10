ALTER TABLE destination_places ADD COLUMN context_version text NOT NULL DEFAULT '';

CREATE TABLE destination_stays (
    stay_id uuid PRIMARY KEY,
    trip_id uuid NOT NULL,
    city_id text NOT NULL,
    visit_order integer NOT NULL,
    arrival_date date,
    departure_date date,
    FOREIGN KEY (trip_id, city_id) REFERENCES destination_places(trip_id, city_id) ON DELETE CASCADE
);
CREATE INDEX destination_stays_trip_order_idx ON destination_stays(trip_id, visit_order, stay_id);

ALTER TABLE activity_jobs DROP COLUMN selected_at;
