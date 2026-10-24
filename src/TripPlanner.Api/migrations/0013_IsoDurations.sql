-- Convert persisted planning/activity durations to ISO 8601 elapsed durations.
CREATE FUNCTION normalize_planning_durations(document jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE entry record; renamed text; item jsonb; result jsonb := '{}';
    names constant jsonb := '{"breakfastMinutes":"breakfastDuration","lunchMinutes":"lunchDuration","dinnerMinutes":"dinnerDuration","slackMinutes":"slackDuration","airportArrivalBufferMinutes":"airportArrivalBufferDuration","airportDepartureBufferMinutes":"airportDepartureBufferDuration","airportTransferMinutes":"airportTransferDuration","walkingMinutes":"walkingDuration","waitingMinutes":"waitingDuration","availableMinutes":"availableDuration","activityMinutes":"activityDuration","travelMinutes":"travelDuration","mealMinutes":"mealDuration","restMinutes":"restDuration","requiredSlackMinutes":"requiredSlackDuration","overrunMinutes":"overrunDuration","durationMinutes":"duration","minutes":"duration"}';
BEGIN
    IF jsonb_typeof(document) = 'object' THEN
        FOR entry IN SELECT key, value FROM jsonb_each(document) LOOP
            renamed := COALESCE(names->>entry.key, entry.key);
            -- If both forms exist, retain the explicitly saved new field.
            IF renamed <> entry.key AND document ? renamed THEN CONTINUE; END IF;
            item := entry.value;
            IF names ? entry.key AND jsonb_typeof(item) = 'number' THEN
                item := to_jsonb(CASE WHEN (item #>> '{}')::numeric < 0 THEN '-' ELSE '' END
                    || 'PT' || abs((item #>> '{}')::numeric)::text || 'M');
            ELSE item := normalize_planning_durations(item); END IF;
            result := result || jsonb_build_object(renamed, item);
        END LOOP;
        RETURN result;
    ELSIF jsonb_typeof(document) = 'array' THEN
        RETURN COALESCE((SELECT jsonb_agg(normalize_planning_durations(value) ORDER BY ordinal)
            FROM jsonb_array_elements(document) WITH ORDINALITY entries(value, ordinal)), '[]');
    END IF;
    RETURN document;
END $$;

UPDATE activities SET properties = normalize_planning_durations(properties)
WHERE properties IS DISTINCT FROM normalize_planning_durations(properties);
UPDATE activity_jobs SET result = normalize_planning_durations(result)
WHERE result IS DISTINCT FROM normalize_planning_durations(result);
UPDATE activity_preferences SET preferences = normalize_planning_durations(preferences)
WHERE preferences IS DISTINCT FROM normalize_planning_durations(preferences);
UPDATE activity_plans SET plan = normalize_planning_durations(plan), assessment = normalize_planning_durations(assessment)
WHERE plan IS DISTINCT FROM normalize_planning_durations(plan)
    OR assessment IS DISTINCT FROM normalize_planning_durations(assessment);
UPDATE activity_planning_evidence SET evidence = normalize_planning_durations(evidence)
WHERE evidence IS DISTINCT FROM normalize_planning_durations(evidence);
UPDATE activity_plan_jobs SET job = normalize_planning_durations(job), result = normalize_planning_durations(result)
WHERE job IS DISTINCT FROM normalize_planning_durations(job)
    OR result IS DISTINCT FROM normalize_planning_durations(result);

DROP FUNCTION normalize_planning_durations(jsonb);
