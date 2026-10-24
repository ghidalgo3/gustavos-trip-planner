-- Upgrade only named planning clock fields. Keep dates, timestamps, durations,
-- free text, and existing ISO times unchanged, including nested job results.
CREATE FUNCTION normalize_planning_clock_times(document jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
    IF jsonb_typeof(document) = 'object' THEN
        RETURN COALESCE((SELECT jsonb_object_agg(key,
            CASE WHEN key IN ('sleepStart','sleepEnd','availableFrom','availableUntil','fixedStart','start','end')
                AND jsonb_typeof(value) = 'string'
                AND value #>> '{}' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
            THEN to_jsonb((value #>> '{}') || ':00')
            ELSE normalize_planning_clock_times(value) END)
            FROM jsonb_each(document)), '{}');
    ELSIF jsonb_typeof(document) = 'array' THEN
        RETURN COALESCE((SELECT jsonb_agg(normalize_planning_clock_times(value) ORDER BY ordinal)
            FROM jsonb_array_elements(document) WITH ORDINALITY entries(value, ordinal)), '[]');
    END IF;
    RETURN document;
END $$;

UPDATE activity_preferences SET preferences = normalize_planning_clock_times(preferences)
WHERE preferences IS DISTINCT FROM normalize_planning_clock_times(preferences);
UPDATE activity_plans SET plan = normalize_planning_clock_times(plan)
WHERE plan IS DISTINCT FROM normalize_planning_clock_times(plan);
UPDATE activity_planning_evidence SET evidence = normalize_planning_clock_times(evidence)
WHERE evidence IS DISTINCT FROM normalize_planning_clock_times(evidence);
UPDATE activity_plan_jobs SET job = normalize_planning_clock_times(job), result = normalize_planning_clock_times(result)
WHERE job IS DISTINCT FROM normalize_planning_clock_times(job)
    OR result IS DISTINCT FROM normalize_planning_clock_times(result);

DROP FUNCTION normalize_planning_clock_times(jsonb);
