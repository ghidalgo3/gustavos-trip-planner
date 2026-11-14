-- Preserve saved plan membership, days and rules while renaming activity states.
ALTER TABLE activities DISABLE TRIGGER reconcile_planning_activities;

UPDATE activities
SET properties = jsonb_set(properties, '{state}', to_jsonb(CASE properties->>'state'
        WHEN 'Planned' THEN 'Yes'
        WHEN 'Rejected' THEN 'No'
        ELSE 'Maybe' END)),
    updated_at = clock_timestamp()
WHERE properties->>'state' IN ('Proposed', 'Planned', 'Rejected');

CREATE OR REPLACE FUNCTION reconcile_activity_plan_references() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid; city text; old_plan jsonb; new_plan jsonb;
BEGIN
    target := COALESCE(NEW.trip_id,OLD.trip_id); city := COALESCE(NEW.city_id,OLD.city_id);
    SELECT plan INTO old_plan FROM activity_plans WHERE trip_id=target AND city_id=city FOR UPDATE;
    IF old_plan IS NULL THEN RETURN COALESCE(NEW,OLD); END IF;
    new_plan := old_plan || jsonb_build_object(
        'selectedActivityIds',COALESCE((SELECT jsonb_agg(id ORDER BY id) FROM activities WHERE trip_id=target AND city_id=city AND properties->>'state'='Yes'),'[]'),
        'excludedActivityIds',COALESCE((SELECT jsonb_agg(id ORDER BY id) FROM activities WHERE trip_id=target AND city_id=city AND properties->>'state'='No'),'[]'),
        'days',COALESCE((SELECT jsonb_agg(d || jsonb_build_object('activityIds',COALESCE((SELECT jsonb_agg(a.value ORDER BY a.ordinality) FROM jsonb_array_elements(d->'activityIds') WITH ORDINALITY a(value,ordinality) WHERE EXISTS(SELECT 1 FROM activities x WHERE x.id=(a.value#>>'{}')::uuid AND x.trip_id=target AND x.city_id=city AND x.properties->>'state'='Yes')),'[]')) ORDER BY n)
            FROM jsonb_array_elements(old_plan->'days') WITH ORDINALITY ds(d,n) WHERE EXISTS(SELECT 1 FROM destination_stays s WHERE s.stay_id=(d->>'stayId')::uuid AND s.trip_id=target AND s.city_id=city)),'[]'),
        'rules',COALESCE((SELECT jsonb_agg(CASE WHEN r->>'afterActivityId' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM activities x WHERE x.id=(r->>'afterActivityId')::uuid AND x.trip_id=target) THEN r || '{"afterActivityId":null}' ELSE r END ORDER BY n)
            FROM jsonb_array_elements(old_plan->'rules') WITH ORDINALITY rs(r,n) WHERE EXISTS(SELECT 1 FROM activities x WHERE x.id=(r->>'activityId')::uuid AND x.trip_id=target AND x.city_id=city AND x.properties->>'state'<>'No')),'[]'),
        'transportOverrides',COALESCE((SELECT jsonb_agg(r ORDER BY n) FROM jsonb_array_elements(old_plan->'transportOverrides') WITH ORDINALITY rs(r,n)
          WHERE (r->>'fromActivityId' IS NULL OR EXISTS(SELECT 1 FROM activities x WHERE x.id=(r->>'fromActivityId')::uuid AND x.trip_id=target AND x.city_id=city))
            AND (r->>'toActivityId' IS NULL OR EXISTS(SELECT 1 FROM activities x WHERE x.id=(r->>'toActivityId')::uuid AND x.trip_id=target AND x.city_id=city))),'[]'));
    IF new_plan<>old_plan THEN UPDATE activity_plans SET plan=new_plan,version=version+1 WHERE trip_id=target AND city_id=city; END IF;
    RETURN COALESCE(NEW,OLD);
END $$;
ALTER TABLE activities ENABLE TRIGGER reconcile_planning_activities;
