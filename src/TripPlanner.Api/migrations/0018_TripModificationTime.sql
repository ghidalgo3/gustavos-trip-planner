-- Persist a stable modification instant for the shared calendar projection.
-- Updating a revision (including preference or travel changes) advances this
-- timestamp without changing resource-specific optimistic-concurrency versions.
ALTER TABLE activity_planning_versions ADD COLUMN modified_at timestamptz NOT NULL DEFAULT now();
CREATE FUNCTION stamp_planning_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.revision IS DISTINCT FROM OLD.revision THEN NEW.modified_at := clock_timestamp(); END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER stamp_planning_revision BEFORE UPDATE ON activity_planning_versions
FOR EACH ROW EXECUTE FUNCTION stamp_planning_revision();
