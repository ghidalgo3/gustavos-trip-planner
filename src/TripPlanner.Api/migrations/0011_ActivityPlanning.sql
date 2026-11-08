CREATE TABLE activity_planning_versions (
    trip_id uuid PRIMARY KEY REFERENCES trips(id) ON DELETE CASCADE,
    revision bigint NOT NULL DEFAULT 1
);
INSERT INTO activity_planning_versions(trip_id) SELECT id FROM trips;

CREATE TABLE activity_preferences (
    subject_id uuid NOT NULL,
    scope text NOT NULL CHECK(scope IN ('profile','trip','destination')),
    city_id text NOT NULL DEFAULT '',
    version bigint NOT NULL,
    preferences jsonb NOT NULL,
    PRIMARY KEY(subject_id,scope,city_id)
);
CREATE TABLE activity_plans (
    trip_id uuid NOT NULL,
    city_id text NOT NULL,
    version bigint NOT NULL,
    input_revision bigint NOT NULL,
    plan jsonb NOT NULL,
    assessment jsonb NOT NULL,
    saved_at timestamptz NOT NULL,
    PRIMARY KEY(trip_id,city_id),
    FOREIGN KEY(trip_id,city_id) REFERENCES destination_places(trip_id,city_id) ON DELETE CASCADE
);
CREATE TABLE activity_planning_evidence (
    trip_id uuid NOT NULL,
    city_id text NOT NULL,
    evidence jsonb NOT NULL,
    PRIMARY KEY(trip_id,city_id),
    FOREIGN KEY(trip_id,city_id) REFERENCES destination_places(trip_id,city_id) ON DELETE CASCADE
);
CREATE TABLE activity_plan_jobs (
    operation_id uuid PRIMARY KEY REFERENCES operations(id) ON DELETE CASCADE,
    trip_id uuid NOT NULL,
    city_id text NOT NULL,
    user_id uuid NOT NULL REFERENCES users(id),
    request_hash text NOT NULL,
    job jsonb NOT NULL,
    result jsonb,
    review jsonb NOT NULL DEFAULT '{"dismissedSuggestionIds":[]}',
    error text,
    lease_id uuid,
    lease_expires_at timestamptz,
    attempts integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY(trip_id,city_id) REFERENCES destination_places(trip_id,city_id) ON DELETE CASCADE
);
CREATE INDEX activity_plan_jobs_queue_idx ON activity_plan_jobs(created_at) WHERE error IS NULL;
CREATE TABLE activity_calendar_subscriptions (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    token_hash text NOT NULL UNIQUE,
    created_at timestamptz NOT NULL,
    revoked_at timestamptz
);

-- Every planning input mutation participates in the same revision lock. Plan writes
-- lock this row before checking their readView and changing activity membership.
CREATE FUNCTION bump_activity_planning_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid;
BEGIN
    IF TG_OP='UPDATE' AND to_jsonb(NEW)=to_jsonb(OLD) THEN RETURN NEW; END IF;
    IF TG_TABLE_NAME='trips' THEN target := COALESCE(NEW.id,OLD.id);
    ELSE target := COALESCE(NEW.trip_id,OLD.trip_id); END IF;
    IF EXISTS(SELECT 1 FROM trips WHERE id=target) THEN
        INSERT INTO activity_planning_versions(trip_id,revision) VALUES(target,1)
        ON CONFLICT(trip_id) DO UPDATE SET revision=activity_planning_versions.revision+1;
    END IF;
    RETURN COALESCE(NEW,OLD);
END $$;
CREATE TRIGGER planning_trip_input AFTER INSERT OR UPDATE ON trips FOR EACH ROW EXECUTE FUNCTION bump_activity_planning_revision();
CREATE TRIGGER planning_activity_input AFTER INSERT OR UPDATE OR DELETE ON activities FOR EACH ROW EXECUTE FUNCTION bump_activity_planning_revision();
CREATE TRIGGER planning_place_input AFTER INSERT OR UPDATE OR DELETE ON destination_places FOR EACH ROW EXECUTE FUNCTION bump_activity_planning_revision();
CREATE TRIGGER planning_visit_input AFTER INSERT OR UPDATE OR DELETE ON destination_stays FOR EACH ROW EXECUTE FUNCTION bump_activity_planning_revision();
CREATE TRIGGER planning_stay_input AFTER INSERT OR UPDATE OR DELETE ON destination_stay_locations FOR EACH ROW EXECUTE FUNCTION bump_activity_planning_revision();
CREATE TRIGGER planning_party_input AFTER INSERT OR UPDATE OR DELETE ON parties FOR EACH ROW EXECUTE FUNCTION bump_activity_planning_revision();
CREATE TRIGGER planning_evidence_input AFTER INSERT OR UPDATE OR DELETE ON activity_planning_evidence FOR EACH ROW EXECUTE FUNCTION bump_activity_planning_revision();

CREATE FUNCTION planning_preferences_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.scope='profile' THEN
        UPDATE activity_planning_versions v SET revision=revision+1 WHERE EXISTS(
            SELECT 1 FROM trips t WHERE t.id=v.trip_id AND (t.owner_user_id=NEW.subject_id OR EXISTS(
                SELECT 1 FROM parties p WHERE p.trip_id=t.id AND NEW.subject_id=ANY(p.user_ids))));
    ELSE UPDATE activity_planning_versions SET revision=revision+1 WHERE trip_id=NEW.subject_id;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER planning_preferences_input AFTER INSERT OR UPDATE ON activity_preferences FOR EACH ROW EXECUTE FUNCTION planning_preferences_changed();

CREATE FUNCTION reconcile_activity_plan_references() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid; city text; old_plan jsonb; new_plan jsonb;
BEGIN
    target := COALESCE(NEW.trip_id,OLD.trip_id); city := COALESCE(NEW.city_id,OLD.city_id);
    SELECT plan INTO old_plan FROM activity_plans WHERE trip_id=target AND city_id=city FOR UPDATE;
    IF old_plan IS NULL THEN RETURN COALESCE(NEW,OLD); END IF;
    new_plan := old_plan || jsonb_build_object(
        'selectedActivityIds',COALESCE((SELECT jsonb_agg(id ORDER BY id) FROM activities WHERE trip_id=target AND city_id=city AND properties->>'state'='Planned'),'[]'),
        'excludedActivityIds',COALESCE((SELECT jsonb_agg(id ORDER BY id) FROM activities WHERE trip_id=target AND city_id=city AND properties->>'state'='Rejected'),'[]'),
        'days',COALESCE((SELECT jsonb_agg(d || jsonb_build_object('activityIds',COALESCE((SELECT jsonb_agg(a.value ORDER BY a.ordinality) FROM jsonb_array_elements(d->'activityIds') WITH ORDINALITY a(value,ordinality) WHERE EXISTS(SELECT 1 FROM activities x WHERE x.id=(a.value#>>'{}')::uuid AND x.trip_id=target AND x.city_id=city AND x.properties->>'state'='Planned')),'[]')) ORDER BY n)
            FROM jsonb_array_elements(old_plan->'days') WITH ORDINALITY ds(d,n) WHERE EXISTS(SELECT 1 FROM destination_stays s WHERE s.stay_id=(d->>'stayId')::uuid AND s.trip_id=target AND s.city_id=city)),'[]'),
        'rules',COALESCE((SELECT jsonb_agg(CASE WHEN r->>'afterActivityId' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM activities x WHERE x.id=(r->>'afterActivityId')::uuid AND x.trip_id=target) THEN r || '{"afterActivityId":null}' ELSE r END ORDER BY n)
            FROM jsonb_array_elements(old_plan->'rules') WITH ORDINALITY rs(r,n) WHERE EXISTS(SELECT 1 FROM activities x WHERE x.id=(r->>'activityId')::uuid AND x.trip_id=target AND x.city_id=city AND x.properties->>'state'<>'Rejected')),'[]'),
        'transportOverrides',COALESCE((SELECT jsonb_agg(r ORDER BY n) FROM jsonb_array_elements(old_plan->'transportOverrides') WITH ORDINALITY rs(r,n)
          WHERE (r->>'fromActivityId' IS NULL OR EXISTS(SELECT 1 FROM activities x WHERE x.id=(r->>'fromActivityId')::uuid AND x.trip_id=target AND x.city_id=city))
            AND (r->>'toActivityId' IS NULL OR EXISTS(SELECT 1 FROM activities x WHERE x.id=(r->>'toActivityId')::uuid AND x.trip_id=target AND x.city_id=city))),'[]'));
    IF new_plan<>old_plan THEN UPDATE activity_plans SET plan=new_plan,version=version+1 WHERE trip_id=target AND city_id=city; END IF;
    RETURN COALESCE(NEW,OLD);
END $$;
CREATE TRIGGER reconcile_planning_activities AFTER INSERT OR UPDATE OR DELETE ON activities FOR EACH ROW EXECUTE FUNCTION reconcile_activity_plan_references();
CREATE TRIGGER reconcile_planning_visits AFTER DELETE ON destination_stays FOR EACH ROW EXECUTE FUNCTION reconcile_activity_plan_references();

CREATE FUNCTION revoke_removed_traveller_calendars() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid; saved record; days jsonb;
BEGIN
    target := COALESCE(NEW.trip_id,OLD.trip_id);
    UPDATE activity_calendar_subscriptions c SET revoked_at=now() WHERE c.trip_id=target AND c.revoked_at IS NULL
      AND NOT EXISTS(SELECT 1 FROM trips t WHERE t.id=target AND (t.owner_user_id=c.user_id OR EXISTS(SELECT 1 FROM parties p WHERE p.trip_id=t.id AND c.user_id=ANY(p.user_ids))));
    FOR saved IN SELECT city_id,plan FROM activity_plans WHERE trip_id=target FOR UPDATE LOOP
        SELECT COALESCE(jsonb_agg(d || jsonb_build_object('flightMatches',COALESCE((
            SELECT jsonb_agg(m ORDER BY position) FROM jsonb_array_elements(COALESCE(d->'flightMatches','[]')) WITH ORDINALITY matches(m,position)
            WHERE EXISTS(SELECT 1 FROM trips t WHERE t.id=target AND (t.owner_user_id=(m->>'travellerId')::uuid OR EXISTS(
                SELECT 1 FROM parties p WHERE p.trip_id=target AND (m->>'travellerId')::uuid=ANY(p.user_ids))))),'[]')) ORDER BY ordinal),'[]')
        INTO days FROM jsonb_array_elements(saved.plan->'days') WITH ORDINALITY entries(d,ordinal);
        IF saved.plan->'days'<>days THEN UPDATE activity_plans SET plan=jsonb_set(plan,'{days}',days),version=version+1 WHERE trip_id=target AND city_id=saved.city_id; END IF;
    END LOOP;
    RETURN COALESCE(NEW,OLD);
END $$;
CREATE TRIGGER revoke_planning_calendars AFTER UPDATE OR DELETE ON parties FOR EACH ROW EXECUTE FUNCTION revoke_removed_traveller_calendars();

CREATE FUNCTION cleanup_planning_preferences() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_TABLE_NAME='users' THEN DELETE FROM activity_preferences WHERE subject_id=OLD.id AND scope='profile';
    ELSIF TG_TABLE_NAME='trips' THEN DELETE FROM activity_preferences WHERE subject_id=OLD.id AND scope<>'profile';
    ELSE
        DELETE FROM activity_preferences WHERE subject_id=OLD.trip_id AND scope='destination' AND city_id=OLD.city_id;
        DELETE FROM operations WHERE id IN (SELECT operation_id FROM activity_plan_jobs WHERE trip_id=OLD.trip_id AND city_id=OLD.city_id);
    END IF;
    RETURN OLD;
END $$;
CREATE TRIGGER cleanup_planning_user BEFORE DELETE ON users FOR EACH ROW EXECUTE FUNCTION cleanup_planning_preferences();
CREATE TRIGGER cleanup_planning_trip BEFORE DELETE ON trips FOR EACH ROW EXECUTE FUNCTION cleanup_planning_preferences();
CREATE TRIGGER cleanup_planning_destination BEFORE DELETE ON destination_places FOR EACH ROW EXECUTE FUNCTION cleanup_planning_preferences();
