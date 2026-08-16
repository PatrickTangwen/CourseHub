ALTER TABLE "import_runs"
  ADD COLUMN IF NOT EXISTS "snapshot_lifecycle" text NOT NULL DEFAULT 'published'
  CHECK ("snapshot_lifecycle" IN ('published', 'frozen'));

ALTER TABLE "supported_terms"
  ADD COLUMN IF NOT EXISTS "snapshot_lifecycle" text NOT NULL DEFAULT 'published'
  CHECK ("snapshot_lifecycle" IN ('published', 'frozen'));
