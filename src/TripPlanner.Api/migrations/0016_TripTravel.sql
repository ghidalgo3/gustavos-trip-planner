CREATE TABLE IF NOT EXISTS trip_travel_plans (
    trip_id uuid PRIMARY KEY REFERENCES trips(id) ON DELETE CASCADE,
    version bigint NOT NULL,
    document jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trip_travel_revision
AFTER INSERT OR UPDATE OR DELETE ON trip_travel_plans
FOR EACH ROW EXECUTE FUNCTION bump_activity_planning_revision();

