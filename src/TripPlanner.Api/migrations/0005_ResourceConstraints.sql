-- Existing constraints describe flight searches, not the trip resource.
ALTER TABLE trips ADD COLUMN flight_constraints jsonb NOT NULL DEFAULT '{}'::jsonb;
UPDATE trips SET flight_constraints = constraints, constraints = '{}'::jsonb;
ALTER TABLE destination_places ADD COLUMN constraints jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE trips ADD CONSTRAINT trips_flight_constraints_object CHECK (jsonb_typeof(flight_constraints) = 'object');
ALTER TABLE destination_places ADD CONSTRAINT destination_constraints_object CHECK (jsonb_typeof(constraints) = 'object');
