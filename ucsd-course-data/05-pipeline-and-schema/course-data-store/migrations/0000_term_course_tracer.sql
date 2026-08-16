CREATE TABLE IF NOT EXISTS "import_runs" (
  "artifact_fingerprint" varchar(64) PRIMARY KEY,
  "snapshot_run_id" text NOT NULL,
  "generated_at" timestamptz NOT NULL,
  "term_code" text NOT NULL,
  "imported_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "supported_terms" (
  "term_code" text PRIMARY KEY,
  "term_label" text NOT NULL,
  "date_start" date,
  "date_end" date,
  "snapshot_generated_at" timestamptz NOT NULL,
  "artifact_fingerprint" varchar(64) NOT NULL REFERENCES "import_runs"("artifact_fingerprint")
);

CREATE TABLE IF NOT EXISTS "courses" (
  "term_code" text NOT NULL REFERENCES "supported_terms"("term_code") ON DELETE CASCADE,
  "course_id" text NOT NULL,
  "subject" text NOT NULL,
  "course_number" text NOT NULL,
  "title" text NOT NULL,
  "units" text,
  "description" text,
  "prerequisites_text" text,
  "restrictions_text" text,
  "catalog_url" text,
  PRIMARY KEY ("term_code", "course_id")
);

CREATE INDEX IF NOT EXISTS "courses_term_code_idx" ON "courses"("term_code");
