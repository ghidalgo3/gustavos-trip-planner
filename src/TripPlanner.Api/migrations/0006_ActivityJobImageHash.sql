-- Early installations applied 0003 before image hashes were added to that file.
-- Add the column for those databases and retain hashes after image cleanup so
-- a retried request can still be checked against its original image.
ALTER TABLE activity_jobs ADD COLUMN IF NOT EXISTS image_sha256 text;
UPDATE activity_jobs
SET image_sha256 = upper(encode(sha256(image), 'hex'))
WHERE image IS NOT NULL AND image_sha256 IS NULL;
