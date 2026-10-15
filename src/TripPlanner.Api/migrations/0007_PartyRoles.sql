ALTER TABLE parties ADD COLUMN member_roles jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE parties ADD CONSTRAINT party_roles_object CHECK (jsonb_typeof(member_roles) = 'object');

CREATE FUNCTION can_plan_trip(trip_id uuid, user_id uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
    SELECT EXISTS (
        SELECT 1 FROM trips t
        WHERE t.id = trip_id AND (
            t.owner_user_id = user_id OR EXISTS (
                SELECT 1 FROM parties p
                WHERE p.trip_id = t.id AND user_id = ANY(p.user_ids)
                  AND p.member_roles ->> user_id::text = 'Planner'
            )
        )
    );
$$;
