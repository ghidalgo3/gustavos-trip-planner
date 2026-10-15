CREATE TABLE destination_stay_locations (
    trip_id uuid NOT NULL,
    city_id text NOT NULL,
    feature jsonb NOT NULL,
    PRIMARY KEY (trip_id, city_id),
    FOREIGN KEY (trip_id, city_id) REFERENCES destination_places(trip_id, city_id) ON DELETE CASCADE
);
