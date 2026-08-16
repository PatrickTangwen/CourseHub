CREATE TABLE IF NOT EXISTS "sections" (
  "term_code" text NOT NULL,
  "section_id" text NOT NULL,
  "course_id" text NOT NULL,
  "section_code" text,
  "meeting_type" text,
  PRIMARY KEY ("term_code", "section_id"),
  FOREIGN KEY ("term_code", "course_id")
    REFERENCES "courses"("term_code", "course_id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "meetings" (
  "term_code" text NOT NULL,
  "section_id" text NOT NULL,
  "meeting_index" integer NOT NULL,
  "days" text[] NOT NULL,
  "meeting_date" date,
  "start_time" text,
  "end_time" text,
  "building" text,
  "room" text,
  "is_tba" boolean NOT NULL,
  "meeting_type" text,
  "raw_days" text,
  "raw_time" text,
  "raw_location" text,
  PRIMARY KEY ("term_code", "section_id", "meeting_index"),
  FOREIGN KEY ("term_code", "section_id")
    REFERENCES "sections"("term_code", "section_id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "instructors" (
  "instructor_name" text PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS "section_instructors" (
  "term_code" text NOT NULL,
  "section_id" text NOT NULL,
  "instructor_name" text NOT NULL REFERENCES "instructors"("instructor_name") ON DELETE CASCADE,
  PRIMARY KEY ("term_code", "section_id", "instructor_name"),
  FOREIGN KEY ("term_code", "section_id")
    REFERENCES "sections"("term_code", "section_id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "sections_course_idx"
  ON "sections"("term_code", "course_id");
CREATE INDEX IF NOT EXISTS "meetings_section_idx"
  ON "meetings"("term_code", "section_id");
CREATE INDEX IF NOT EXISTS "section_instructors_section_idx"
  ON "section_instructors"("term_code", "section_id");
