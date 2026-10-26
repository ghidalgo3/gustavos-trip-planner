DO $$ BEGIN
    IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='trip_travel_plans'::regclass AND conname='trip_travel_document_array') THEN
        ALTER TABLE trip_travel_plans ADD CONSTRAINT trip_travel_document_array CHECK(jsonb_typeof(document)='array');
    END IF;
END $$;

-- Calendar connections own references to their activities/visits. Removing one
-- cleans up the complete connection row document in the same transaction.
CREATE OR REPLACE FUNCTION cleanup_trip_travel_reference() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE field_name text; removed_id text; remaining jsonb;
BEGIN
    IF TG_TABLE_NAME='activities' THEN field_name := 'activityId'; removed_id := OLD.id::text;
    ELSE field_name := 'visitId'; removed_id := OLD.stay_id::text; END IF;
    PERFORM 1 FROM trip_travel_plans WHERE trip_id=OLD.trip_id FOR UPDATE;
    SELECT COALESCE(jsonb_agg(connection ORDER BY position),'[]'::jsonb) INTO remaining
    FROM trip_travel_plans plan,
         jsonb_array_elements(plan.document) WITH ORDINALITY AS entries(connection,position)
    WHERE plan.trip_id=OLD.trip_id
      AND COALESCE(connection->'from'->>field_name,'')<>removed_id
      AND COALESCE(connection->'to'->>field_name,'')<>removed_id
      AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(connection->'segments','[]'::jsonb)) segment
                     WHERE segment->'from'->>field_name=removed_id OR segment->'to'->>field_name=removed_id);
    UPDATE trip_travel_plans SET document=remaining,version=version+1,updated_at=now()
    WHERE trip_id=OLD.trip_id AND document<>remaining;
    RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS cleanup_travel_activity ON activities;
CREATE TRIGGER cleanup_travel_activity AFTER DELETE ON activities
FOR EACH ROW EXECUTE FUNCTION cleanup_trip_travel_reference();
DROP TRIGGER IF EXISTS cleanup_travel_visit ON destination_stays;
CREATE TRIGGER cleanup_travel_visit AFTER DELETE ON destination_stays
FOR EACH ROW EXECUTE FUNCTION cleanup_trip_travel_reference();
