ALTER TABLE trips
    ADD COLUMN flight_choices jsonb NOT NULL DEFAULT '{}'::jsonb,
    ADD CONSTRAINT trips_flight_choices_object
        CHECK (jsonb_typeof(flight_choices) = 'object');
