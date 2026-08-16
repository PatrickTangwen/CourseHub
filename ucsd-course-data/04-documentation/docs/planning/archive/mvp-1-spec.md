# MVP-1 Implementation Spec

最后更新：2026-06-19

本文是 UCSD Course Planning Platform 的 MVP-1 当前执行规格。若本文与 `docs/planning/archive/ucsd-coursetable-plan.md` 早期章节冲突，以本文和 `docs/planning/archive/ucsd-coursetable-plan.md` Section 13 为准。

## 1. MVP-1 Goal

MVP-1 要验证三件事：

1. 能从 UCSD public sources 生成可信的课程数据 snapshot。
2. CourseTable fork 能消费 UCSD course/section/meeting 数据，完成查课和排课。
3. 不依赖登录、数据库、Hasura 或实时动态数据，也能提供完整匿名选课规划体验。

MVP-1 是 public catalog + anonymous worksheet，不是完整 CourseTable clone。

## 2. Scope

MVP-1 includes:

- Public catalog search
- Course detail
- Anonymous Worksheet
- Browser `localStorage` worksheet persistence
- Shareable worksheet URL
- Conflict detection
- ICS download
- UCSD Schedule of Classes crawler/parser
- UCSD General Catalog crawler/parser
- UCSD Instructor Grade Archive crawler/parser
- File-first Catalog Snapshot generation
- Catalog Snapshot validation and atomic publish
- CSE and MATH only

MVP-1 excludes:

- Login / user account
- App DB
- Course Data Store
- Hasura user-path dependency
- Saved worksheets
- Saved searches
- Wishlist
- Profile/privacy settings
- Friends features
- UCSD college GE mapping UI
- SET/CAPE integration
- Google Calendar direct export
- PNG export
- Open seats / availability / waitlist / enrollment / demand tracking
- Multi-term schedule browsing

## 3. Domain Model

Use this product language in PRDs/issues:

- `Course`: catalog-level class identified by subject + course number.
- `Section`: term-specific scheduled offering that can be added to a worksheet.
- `Meeting`: time/location block belonging to a section; a section may have zero, one, or many meetings.
- `Catalog Snapshot`: term-scoped JSON artifact consumed by the frontend.
- `Published Snapshot`: validated static snapshot currently served by the app.
- `Anonymous Worksheet`: browser-local worksheet not attached to an account.
- `Average GPA`: user-facing GPA summary; unweighted mean GPA across matching Grade Archive Records in the most recent archive term with data.
- `Record Count`: total number of matching Grade Archive Records across all terms.
- `Past Grades`: Course detail tab containing raw Grade Archive Records.

Avoid these terms in product specs:

- `Listing` for UCSD product language
- `Course rating`
- `Workload`
- `Professor quality`
- `Open seats`
- `Enrollment tracker`
- `Student count` for grade archive data

## 4. Configuration

MVP-1 must be driven by a config file, not hard-coded parser logic.

Required config:

```yaml
active_planning_term: '<ucsd-term-code>'
term_label: '<human-readable-term>'
term_date_range:
  start: 'YYYY-MM-DD'
  end: 'YYYY-MM-DD'
configured_subjects:
  - CSE
  - MATH
paths:
  raw_dir: 'data/raw'
  normalized_dir: 'data/normalized'
  reports_dir: 'data/reports'
  public_catalog_dir: 'api/static/catalogs/public'
  metadata_path: 'api/static/metadata.json'
```

Acceptance:

- Changing subjects requires editing config only.
- Active term and term date range are visible in import reports.
- Frontend metadata shows the snapshot source timestamp.

## 5. Data Sources

### 5.1 UCSD Schedule Of Classes

Source:

https://act.ucsd.edu/scheduleOfClasses/scheduleOfClassesStudent.htm

Purpose:

- Active planning term schedule
- Courses
- Sections
- Meetings
- Instructors
- Building/room text
- Raw schedule notes if available

Do not use:

- Seats availability
- Hide full sections
- Waitlist/capacity/enrollment data

Schedule parser must preserve:

- raw subject
- raw course number
- raw section id
- raw term
- raw meeting day/time/location text
- source URL
- fetch timestamp

### 5.2 UCSD General Catalog

Source:

https://catalog.ucsd.edu/

Purpose:

- Course title
- Units
- Description
- Prerequisites raw text
- Restrictions raw text
- Catalog URL

MVP-1 does not parse prerequisite logic. It only displays raw text.

### 5.3 UCSD Instructor Grade Archive

Source:

https://qa-as.ucsd.edu/Home/InstructorGradeArchive

This is a POST form. Query by `subject`, using configured subjects.

Expected result columns:

- Subject
- Course
- Year
- Quarter
- Title
- Instructor
- GPA
- A
- B
- C
- D
- F
- W
- P
- NP

Important:

- Grade buckets are percentages, not counts.
- No student count is provided.
- No sample-size-weighted GPA is allowed.
- Starter CSV files are reference/fallback only, not MVP-1 primary source.

## 6. Identity Rules

Course ID:

```text
normalize(subject) + ":" + normalize(course_number)
```

Example:

```text
CSE:101
MATH:20A
```

Section ID:

```text
active_planning_term + ":" + ucsd_source_section_id
```

Rules:

- Worksheet and share URLs store Section IDs.
- Do not use title, instructor, meeting time, or location as identity.
- Raw source values must be preserved for debugging.
- Cross-listed courses are not auto-merged in MVP-1 unless there is reliable source evidence.

## 7. Snapshot Contract

MVP-1 frontend reads only the Catalog Snapshot and metadata for course data.

Required public outputs:

```text
api/static/catalogs/public/{activePlanningTerm}.json
api/static/metadata.json
```

Conceptual snapshot shape:

```ts
type CatalogSnapshot = {
  run_id: string;
  generated_at: string;
  active_planning_term: string;
  term_label: string;
  configured_subjects: string[];
  courses: Course[];
};

type Course = {
  course_id: string;
  subject: string;
  course_number: string;
  title: string;
  units: string | null;
  description: string | null;
  prerequisites_text: string | null;
  restrictions_text: string | null;
  catalog_url: string | null;
  archive_avg_gpa: number | null;
  archive_record_count: number;
  grade_archive_records: GradeArchiveRecord[];
  ge_matches: [];
  sections: Section[];
};

type Section = {
  section_id: string;
  course_id: string;
  section_code: string | null;
  meeting_type: string | null;
  instructors: string[];
  meetings: Meeting[];
  raw: Record<string, unknown>;
};

type Meeting = {
  days: string[];
  start_time: string | null;
  end_time: string | null;
  building: string | null;
  room: string | null;
  is_tba: boolean;
  raw_days: string | null;
  raw_time: string | null;
  raw_location: string | null;
};
```

Public snapshot must not include:

- `seats_available`
- `seats_limit`
- `waitlist`
- `capacity`
- `enrollment`
- `demand`
- friends fields
- evaluation fields

## 8. Pipeline Behavior

MVP-1 pipeline is file-first.

Flow:

1. Fetch raw HTML for Schedule, Catalog, and Grade Archive.
2. Save raw snapshots.
3. Parse normalized artifacts.
4. Merge by Course ID and Section ID.
5. Generate staging Catalog Snapshot.
6. Validate staging snapshot.
7. Atomically publish static JSON and metadata.
8. Write import report.

Failure policy:

- Fail hard on any configured subject/source parser failure.
- Do not publish partial snapshots.
- Do not overwrite existing Published Snapshot on failure.
- Preserve raw HTML and reports for debugging.

Validation gate must check:

- Schema validity
- Configured subjects present
- Every Section has stable Section ID
- No excluded availability/demand/friend/eval fields
- Metadata has `run_id`, `generated_at`, source timestamps
- Snapshot and metadata belong to the same run

## 9. GPA Rules

Raw Grade Archive Records must be visible in the Course detail Past Grades tab.

Course-level `Average GPA`:

```text
mean(GPA for matching Grade Archive Records in the most recent archive term)
```

Instructor-course stats:

```text
mean(GPA for records matching Course ID + normalized instructor)
```

Display:

- `Average GPA` in catalog results and Course detail Overview
- `Record Count` in catalog results
- raw rows in the Past Grades tab: Year, Quarter, Instructor, GPA, A/B/C/D/F/W/P/NP percentages

Do not display:

- Student count
- Sample size
- Weighted GPA
- Professor rating
- Workload
- Recommendation score

## 10. Catalog UI

MVP-1 catalog supports one primary list/table view.

Search/filter:

- keyword search across subject, course number, title, instructor, description
- subject filter
- course level filter: lower division / upper division / graduate
- days filter
- time range filter
- meeting type filter
- Average GPA min/max
- hide conflicts with current Anonymous Worksheet

Sort:

- course code
- title
- meeting time
- Average GPA
- Record Count

Remove from MVP paths:

- Yale copy
- friends/friend count
- evals/OCE/SET/CAPE live fetch
- open seats / availability / waitlist / enrollment / demand
- GE filter
- saved searches
- random course
- grid view

## 11. Course Detail

Course detail must show:

- Course ID-facing display: subject + course number
- title
- units
- description
- prerequisites raw text
- restrictions raw text if present
- catalog URL/source
- sections
- meetings
- instructors
- building/room text
- TBA/arranged display
- Average GPA
- raw Grade Archive Records in the Past Grades tab
- source timestamp where available

Course detail must not show:

- eligibility/prequisite judgment
- friends taking course
- syllabus/past syllabus
- maps/walking time
- open seats/availability
- eval narratives
- professor rating/workload

## 12. Anonymous Worksheet

MVP-1 worksheet supports:

- add Section
- remove Section
- browser `localStorage` persistence
- share URL restore
- conflict detection
- ICS download

No login is required.

No server-side share record is created.

## 13. Share URL

Minimum URL format:

```text
/worksheet?t={activePlanningTerm}&sections={sectionId1},{sectionId2}
```

Rules:

- URL stores Section IDs only.
- Restore by looking up Section IDs in the Catalog Snapshot.
- Missing Section IDs show a non-blocking warning.
- Missing IDs must not crash the page.
- No title/instructor/time/location in URL identity.

## 14. Conflict Detection

Rules:

- A Section can have 0, 1, or many Meetings.
- Timed Meetings participate in conflict detection.
- TBA/arranged Meetings do not participate.
- Two Sections conflict if any timed Meeting overlaps.
- Conflicts do not block adding to worksheet.
- Conflict UI must make conflicts visible.

## 15. ICS Download

MVP-1 supports `.ics` download only.

No Google Calendar direct export.

ICS rules:

- Export selected Sections' timed Meetings.
- Skip TBA/arranged Meetings.
- Show skipped count/summary.
- Use configured Term Date Range.
- Conflicts do not block export.

Event fields:

- title: `{subject} {course_number} {section_code} - {meeting_type}`
- location: `{building} {room}` or raw location
- description: course title, instructor, UCSD Schedule source note

## 16. Testing Requirements

Parser fixture tests:

- Schedule parser: CSE and MATH fixtures
- Catalog parser: CSE and MATH fixtures
- Grade Archive parser: CSE and MATH fixtures

Parser cases:

- TBA/arranged meeting
- multi-meeting section
- missing instructor
- missing/malformed GPA
- raw source text preserved

Snapshot validation tests:

- validates schema
- rejects missing Section ID
- rejects excluded availability fields
- rejects missing configured subject
- rejects partial generation
- preserves existing Published Snapshot on validation failure

Frontend behavior tests:

- catalog loads Catalog Snapshot
- keyword search works
- subject filter works
- meeting type filter works
- hide conflicts works
- share URL restores Anonymous Worksheet
- ICS export skips TBA/arranged Meetings

## 17. Issue Slicing

Recommended issue sequence:

1. Project setup and config
2. Instructor Grade Archive crawler/parser
3. UCSD General Catalog parser
4. UCSD Schedule parser
5. Snapshot schema + validator + atomic publisher
6. Frontend snapshot adapter
7. Catalog MVP UI cleanup
8. Anonymous Worksheet + share URL
9. Conflict detection + ICS export
10. Polish / smoke tests / documentation

## 18. MVP-1 Acceptance Checklist

MVP-1 is complete when:

- One-command snapshot generation succeeds for `CSE` and `MATH`.
- Published Snapshot contains only configured subjects.
- Published Snapshot excludes Availability Data, demand, friends, eval fields.
- Catalog loads without login, App DB, Course Data Store, Hasura, or live GraphQL user-path dependency.
- MVP search/filter/sort works.
- Course detail shows schedule, catalog raw prereq, Average GPA, and Past Grades raw Grade Archive Records.
- Anonymous Worksheet supports add/remove Sections.
- Anonymous Worksheet persists in `localStorage`.
- Share URL restores selected Section IDs in a new browser/private window.
- Missing Section IDs in URL warn without crashing.
- Conflict detection works for timed Meetings and ignores TBA/arranged.
- ICS exports timed Meetings and reports skipped TBA/arranged Meetings.
- Parser fixture tests pass.
- Snapshot validation tests pass.
- Frontend behavior tests pass.
- MVP user paths contain no Yale, friends, evals, availability, enrollment, waitlist, demand, or Google Calendar direct export wording.
