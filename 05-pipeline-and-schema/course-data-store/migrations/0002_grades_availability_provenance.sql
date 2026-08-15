ALTER TABLE "import_runs"
  ADD COLUMN IF NOT EXISTS "schedule_source_timestamp" text,
  ADD COLUMN IF NOT EXISTS "catalog_source_timestamp" text,
  ADD COLUMN IF NOT EXISTS "grade_source_timestamp" text,
  ADD COLUMN IF NOT EXISTS "manifest_fingerprint" varchar(64),
  ADD COLUMN IF NOT EXISTS "manifest_ok" integer,
  ADD COLUMN IF NOT EXISTS "manifest_empty" integer,
  ADD COLUMN IF NOT EXISTS "manifest_failed" integer,
  ADD COLUMN IF NOT EXISTS "manifest_partial" integer;

ALTER TABLE "import_runs"
  ADD CONSTRAINT "import_runs_artifact_term_unique"
  UNIQUE ("artifact_fingerprint", "term_code");

CREATE TABLE IF NOT EXISTS "grade_archive_records" (
  "term_code" text NOT NULL REFERENCES "supported_terms"("term_code") ON DELETE CASCADE,
  "course_id" text NOT NULL,
  "record_index" integer NOT NULL,
  "archive_subject" text NOT NULL,
  "archive_course" text NOT NULL,
  "archive_year" text NOT NULL,
  "archive_quarter" text NOT NULL,
  "archive_title" text,
  "instructor" text,
  "gpa" numeric,
  "a_percent" numeric,
  "b_percent" numeric,
  "c_percent" numeric,
  "d_percent" numeric,
  "f_percent" numeric,
  "w_percent" numeric,
  "p_percent" numeric,
  "np_percent" numeric,
  "raw_record" jsonb NOT NULL,
  PRIMARY KEY ("term_code", "course_id", "record_index"),
  FOREIGN KEY ("term_code", "course_id")
    REFERENCES "courses"("term_code", "course_id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "snapshot_availability" (
  "term_code" text NOT NULL,
  "section_id" text NOT NULL,
  "enrolled" integer,
  "capacity" integer,
  "waitlist_count" integer NOT NULL,
  "observed_at" timestamptz NOT NULL,
  "term_state" text NOT NULL CHECK ("term_state" IN ('upcoming', 'active', 'historical', 'undated')),
  PRIMARY KEY ("term_code", "section_id"),
  FOREIGN KEY ("term_code", "section_id")
    REFERENCES "sections"("term_code", "section_id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "import_manifest_cells" (
  "artifact_fingerprint" varchar(64) NOT NULL,
  "term_code" text NOT NULL,
  "subject" text NOT NULL,
  "source" text NOT NULL,
  "status" text NOT NULL CHECK ("status" IN ('ok', 'empty', 'failed', 'partial')),
  "reason" text,
  "attempts" integer NOT NULL,
  "row_counts" jsonb NOT NULL,
  "raw_artifacts" jsonb NOT NULL,
  "normalized_artifact" text,
  PRIMARY KEY ("artifact_fingerprint", "subject", "source"),
  FOREIGN KEY ("artifact_fingerprint", "term_code")
    REFERENCES "import_runs"("artifact_fingerprint", "term_code") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "grade_archive_course_idx"
  ON "grade_archive_records"("term_code", "course_id");
CREATE INDEX IF NOT EXISTS "snapshot_availability_section_idx"
  ON "snapshot_availability"("term_code", "section_id");
CREATE INDEX IF NOT EXISTS "manifest_cells_term_status_idx"
  ON "import_manifest_cells"("term_code", "status");
