-- Older activity ideas used "idea" for the state now named "Proposed".
UPDATE activities
SET properties = jsonb_set(properties, '{state}', '"Proposed"'::jsonb),
    updated_at = now()
WHERE properties->>'state' = 'idea';
