ALTER TABLE "grade_archive_records"
  ADD COLUMN IF NOT EXISTS "matched_via" text
  CHECK ("matched_via" IS NULL OR "matched_via" = 'cross_listed');

UPDATE "grade_archive_records"
SET "matched_via" = 'cross_listed'
WHERE "matched_via" IS NULL
  AND "course_id" <> upper(btrim("archive_subject")) || ':' ||
    regexp_replace(upper(btrim("archive_course")), '[[:space:]]+', '', 'g');
