-- Earlier migrations may have populated transportation in this transaction.
-- Flush their deferred endpoint checks before changing its table definition.
SET CONSTRAINTS ALL IMMEDIATE;

-- A transport is attached to visits, independently of station/route geometry.
ALTER TABLE destination_stays ADD CONSTRAINT destination_stays_id_trip UNIQUE(stay_id,trip_id);
ALTER TABLE transportation
    ADD COLUMN origin_stay_id uuid GENERATED ALWAYS AS ((document->>'originStayId')::uuid) STORED,
    ADD COLUMN destination_stay_id uuid GENERATED ALWAYS AS ((document->>'destinationStayId')::uuid) STORED,
    ADD CONSTRAINT transportation_origin_visit FOREIGN KEY(origin_stay_id,trip_id)
        REFERENCES destination_stays(stay_id,trip_id) ON DELETE CASCADE,
    ADD CONSTRAINT transportation_destination_visit FOREIGN KEY(destination_stay_id,trip_id)
        REFERENCES destination_stays(stay_id,trip_id) ON DELETE CASCADE,
    ADD CONSTRAINT transportation_different_visits CHECK(origin_stay_id IS DISTINCT FROM destination_stay_id OR origin_stay_id IS NULL);
CREATE UNIQUE INDEX transportation_visit_pair ON transportation(trip_id,origin_stay_id,destination_stay_id)
    NULLS NOT DISTINCT WHERE origin_stay_id IS NOT NULL OR destination_stay_id IS NOT NULL;

SET CONSTRAINTS ALL DEFERRED;
