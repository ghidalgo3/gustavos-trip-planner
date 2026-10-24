-- Retire transit without relabeling historical transit evidence as walking data.
CREATE FUNCTION normalize_planning_transport(document jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE entry record; item jsonb; result jsonb := '{}';
BEGIN
    IF jsonb_typeof(document) = 'object' THEN
        FOR entry IN SELECT key, value FROM jsonb_each(document) LOOP
            item := normalize_planning_transport(entry.value);
            IF entry.key IN ('transportMode', 'mode') AND entry.value = '"transit"'::jsonb THEN
                item := '"walking"'::jsonb;
            END IF;
            -- An explicit transit duration is not a walking duration.
            IF entry.key = 'duration' AND document->>'mode' = 'transit' THEN
                item := 'null'::jsonb;
            END IF;
            result := result || jsonb_build_object(entry.key, item);
        END LOOP;
        RETURN result;
    ELSIF jsonb_typeof(document) = 'array' THEN
        RETURN COALESCE((SELECT jsonb_agg(normalize_planning_transport(value) ORDER BY ordinal)
            FROM jsonb_array_elements(document) WITH ORDINALITY entries(value, ordinal)), '[]');
    END IF;
    RETURN document;
END $$;

UPDATE activity_preferences SET preferences=normalize_planning_transport(preferences), version=version+1
WHERE preferences IS DISTINCT FROM normalize_planning_transport(preferences);
UPDATE activity_plans SET plan=normalize_planning_transport(plan), version=version+1
WHERE plan IS DISTINCT FROM normalize_planning_transport(plan);
UPDATE activity_planning_evidence SET evidence=jsonb_set(evidence,'{routes}',
    COALESCE((SELECT jsonb_agg(route ORDER BY ordinal)
      FROM jsonb_array_elements(evidence->'routes') WITH ORDINALITY entries(route,ordinal)
      WHERE route->>'mode' IS DISTINCT FROM 'transit'), '[]'))
WHERE evidence ? 'routes';
-- Old results/jobs must fail concurrency checks, and saved timing stays stale until accepted.
-- Preserve saved assessments so calendar event times do not move during migration.
UPDATE activity_planning_versions SET revision=revision+1;

DROP FUNCTION normalize_planning_transport(jsonb);
