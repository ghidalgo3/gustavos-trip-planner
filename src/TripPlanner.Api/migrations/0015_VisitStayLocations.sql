-- Preserve the accommodation previously shared by a city on every existing visit.
-- New visits start without accommodation; edits only affect the specified visit.
CREATE TEMP TABLE previous_stay_locations ON COMMIT DROP AS
SELECT trip_id, city_id, feature FROM destination_stay_locations;

DELETE FROM destination_stay_locations;
ALTER TABLE destination_stay_locations DROP CONSTRAINT destination_stay_locations_pkey;
ALTER TABLE destination_stay_locations ADD COLUMN stay_id uuid NOT NULL;
ALTER TABLE destination_stays ADD CONSTRAINT destination_stays_trip_city_visit_key
    UNIQUE (trip_id, city_id, stay_id);
ALTER TABLE destination_stay_locations ADD PRIMARY KEY (trip_id, city_id, stay_id);
ALTER TABLE destination_stay_locations ADD FOREIGN KEY (trip_id, city_id, stay_id)
    REFERENCES destination_stays(trip_id, city_id, stay_id) ON DELETE CASCADE;

INSERT INTO destination_stay_locations(trip_id, city_id, stay_id, feature)
SELECT s.trip_id, s.city_id, v.stay_id,
    jsonb_set(s.feature, '{id}', to_jsonb(v.stay_id::text))
FROM previous_stay_locations s
JOIN destination_stays v ON v.trip_id=s.trip_id AND v.city_id=s.city_id;
