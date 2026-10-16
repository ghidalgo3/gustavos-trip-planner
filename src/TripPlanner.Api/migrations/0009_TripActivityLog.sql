-- Keep historical trip names and actors even after a trip is deleted.
CREATE TABLE trip_activity_log (
    id uuid PRIMARY KEY,
    occurred_at timestamptz NOT NULL,
    actor_user_id uuid NOT NULL,
    actor_name text NOT NULL,
    source text NOT NULL,
    action text NOT NULL,
    trip_id uuid NOT NULL,
    owner_user_id uuid NOT NULL,
    trip_name text NOT NULL,
    resource_id text,
    description text NOT NULL
);
CREATE INDEX trip_activity_log_trip_idx ON trip_activity_log (trip_id, occurred_at DESC, id DESC);
CREATE INDEX trip_activity_log_actor_idx ON trip_activity_log (actor_user_id, occurred_at DESC, id DESC);
CREATE INDEX trip_activity_log_owner_idx ON trip_activity_log (owner_user_id, occurred_at DESC, id DESC);

CREATE FUNCTION prevent_activity_log_changes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'The activity log is append-only';
END;
$$;
CREATE TRIGGER trip_activity_log_immutable BEFORE UPDATE OR DELETE ON trip_activity_log
    FOR EACH ROW EXECUTE FUNCTION prevent_activity_log_changes();
