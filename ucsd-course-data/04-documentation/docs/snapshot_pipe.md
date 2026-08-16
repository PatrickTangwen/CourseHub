# Catalog Snapshot Pipeline Notes

Date: 2026-06-29

Status: implementation and operations notes for the UCSD catalog snapshot
pipeline. This records source behaviors observed while fixing published
snapshot JSON in `api/static/catalogs/public/*.json`.

## Snapshot Consumption Context

Course modals do not fetch UCSD General Catalog descriptions live. They display
the `description` field already present in the published snapshot JSON served by:

- API route: `/api/catalog/public/:term`
- Files: `api/static/catalogs/public/*.json`
- Modal fallback text: `No description available.`

So missing modal descriptions usually mean the snapshot generation/enrichment
step did not attach General Catalog metadata to the schedule course row.

Schedule rows, seats, meeting metadata, exam rows, and modal grouping are also
served from the same published snapshot JSON. Parser fixes do not affect the UI
until the relevant public JSON files are regenerated or replayed from preserved
raw source HTML.

## General Catalog Description Metadata

### Fixed Rules

The General Catalog parser now handles these source patterns:

1. Slash-R aliases

   UCSD General Catalog may write a course as `DSC 20/R`, while Schedule of
   Classes may expose `DSC:20` and/or `DSC:20R`.

   Parser rule:
   - `20/R` -> `20`
   - `20/R` -> `20R`
   - `40B/R` -> `40B`
   - `40B/R` -> `40BR`

2. Classless description paragraphs

   Most catalog descriptions are in:

   ```html
   <p class="course-descriptions">...</p>
   ```

   Some current catalog rows, such as DSC 40B/R, use a plain `<p>` after the
   `course-name` paragraph. The parser now takes the paragraph immediately after
   `course-name` as the description unless it is another course name or anchor.

3. Missing period after course number

   Some catalog rows are shaped like:

   ```text
   COMM 114M CSI: Communication and the Law (4)
   ```

   rather than:

   ```text
   COMM 114M. CSI: Communication and the Law (4)
   ```

   The parser accepts both.

4. Grouped subject code in parentheses

   Some grouped catalog pages write the display title before the subject code:

   ```text
   Linguistics/American Sign Language (LISL) 1A. ...
   ```

   The parser now reads the official subject code from the parentheses.

5. Cross-listed rows

   A single General Catalog row can represent multiple schedule course IDs.
   The parser now expands these patterns:
   - `BENG/BIMM/CSE 181` -> `BENG:181`, `BIMM:181`, `CSE:181`
   - `BENG 242/MATS 257/NANO 257` -> `BENG:242`, `MATS:257`, `NANO:257`
   - `CSE 256/LING 256` -> `CSE:256`, `LING:256`
   - `BENG 191/291` -> `BENG:191`, `BENG:291`

6. Anchor selection

   When multiple anchors precede one course row, the parser prefers the anchor
   matching `${subject}${courseNumber}`. Example:
   - `BENG:191` -> `#beng191`
   - `BENG:291` -> `#beng291`

### Code Touchpoints

- `tools/catalog-snapshot/generalCatalog.ts`
  - Parses UCSD General Catalog HTML.
  - Expands aliases and cross-listed rows.
  - Extracts description, prerequisites, restrictions, units, and catalog URL.

- `tools/catalog-snapshot/scheduleOfClasses.ts`
  - Normalizes schedule-side course numbers consistently with catalog-side `/R`
    handling.

- `tools/catalog-snapshot/generalCatalog.test.ts`
  - Covers `/R` aliases, classless description paragraphs, missing-period rows,
    grouped subject rows, cross-listed rows, and multi-number rows.

### Data Update Summary

After applying the parser fixes and targeted enrichment to existing published
snapshots:

- DSC `/R` examples such as `DSC:10R`, `DSC:20R`, `DSC:40AR`, `DSC:30R`,
  `DSC:40BR`, and `DSC:80R` now have General Catalog descriptions.
- Cross-listed examples such as `BENG:181`, `BENG:242`, `BENG:247A`,
  `CSE:256`, `MATS:257`, and `NANO:247A` were also filled where current General
  Catalog rows supported them.
- Remaining missing descriptions are currently:
  - `2789` term-course rows
  - `921` unique courses

Remaining unique-course breakdown:

| Category                | Count | Meaning                                                                           |
| ----------------------- | ----: | --------------------------------------------------------------------------------- |
| `no_catalog_url`        |   449 | Schedule of Classes did not provide a catalog link.                               |
| `registrar_cnd`         |   160 | Registrar points to `studentlink/cnd.html`.                                       |
| `other_url`             |    39 | Link points outside General Catalog, such as pharmacy pages.                      |
| `catalog_url_unmatched` |   273 | Catalog URL exists, but current catalog did not produce a matching described row. |

### Why Some Courses Still Cannot Be Filled

1. Registrar CND

   If the schedule link is `http://registrar.ucsd.edu/studentlink/cnd.html`, the
   registrar itself says the course is not described in the General Catalog.
   These should not be filled by guessing.

2. No catalog URL

   Many medical/professional/clinical courses have no General Catalog URL in the
   Schedule of Classes snapshot. Without another official source, the snapshot
   cannot faithfully attach a catalog description.

3. Non-General-Catalog URL

   Some courses point to non-catalog pages, for example pharmacy current-student
   pages. Those are not parsed by the General Catalog parser.

4. Current catalog mismatch

   Some old schedule rows have catalog anchors that no longer exist in the
   current General Catalog page. These may require historical catalog pages to
   fill accurately.

5. Official row has no description text

   Some official catalog rows exist but only contain prerequisites or standing
   requirements before the `Prerequisites:` label. Examples observed:
   - `CHEM:299`
   - `MATS:296`
   - `SE:296`

### Useful Audit Commands

Count remaining missing descriptions:

```bash
node --input-type=module - <<'NODE'
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const dir = 'api/static/catalogs/public';
const rows = [];
const unique = new Map();

for (const file of (await readdir(dir)).filter((name) => name.endsWith('.json')).sort()) {
  const term = file.replace('.json', '');
  const data = JSON.parse(await readFile(join(dir, file), 'utf8'));
  for (const course of data.courses ?? []) {
    if (course.description && !/^No description available\.?$/u.test(course.description)) continue;
    rows.push({ term, course_id: course.course_id, subject: course.subject, title: course.title, catalog_url: course.catalog_url });
    if (!unique.has(course.course_id)) unique.set(course.course_id, course);
  }
}

console.log({ missing_rows: rows.length, missing_unique_courses: unique.size });
NODE
```

Verify a specific term/course after enrichment:

```bash
node --input-type=module - <<'NODE'
import { readFile } from 'node:fs/promises';

const data = JSON.parse(await readFile('api/static/catalogs/public/S126.json', 'utf8'));
const course = data.courses.find((row) => row.course_id === 'DSC:20R');
console.log({
  course_id: course?.course_id,
  title: course?.title,
  has_description: Boolean(course?.description),
  catalog_url: course?.catalog_url,
});
NODE
```

### Verification Commands Used

```bash
bun run test:snapshot
bun run typecheck
bun run lint:check
bun run format:check
```

`lint:check` currently passes with existing repository warnings unrelated to the
snapshot description parser work.

## Fall 2026 TSS Metadata Consolidation (2026-07-21)

The normalized metadata directories under `data/normalized/` are term-scoped.
A directory can therefore omit a subject that is present in the Fall 2026 TSS
schedule even when another preserved normalized run contains complete General
Catalog or Instructor Grade Archive data for that subject.

The TSS publisher accepts `--metadata-root` to consolidate those preserved runs.
For each source and subject, it selects the normalized JSON file that covers the
most Course IDs actually scheduled in the target TSS term. Equal-coverage
candidates prefer the newer timestamp encoded in the run directory. This avoids
treating unrelated historical rows as evidence that a file is more complete.
The Import Manifest records the exact selected artifact path. When the selected
subject files span multiple capture timestamps, or a selected non-primary run
has no timestamp in its directory name, the corresponding snapshot-level source
timestamp is `null` rather than claiming one misleading shared timestamp.

Example (any raw directory of tss-chatbot-v1 files works; since 2026-08-03 the
current raw source is the Class Planner conversion output, see the Class
Planner Catalog Source section):

```bash
bun tools/catalog-snapshot/generate-tss-published-snapshot.mts \
  --raw-dir data/raw/classplanner/FA26/<timestamp>/tss \
  --metadata-dir data/normalized/multi-2026-06-29T08-02-01.606Z-198ee9a5-ad5c-428b-be61-71951c951b8f-SP26 \
  --metadata-root data/normalized
```

The primary `--metadata-dir` remains required for backward compatibility. Its
explicit or inferred timestamp is used only for that primary run; it is never
attributed to another run whose timestamp is unknown.

### Cross-listed grade records

When a scheduled course has no exact Instructor Grade Archive rows, the
snapshot may use records from another listing only when the General Catalog
description explicitly says `Cross-listed with SUBJECT NUMBER`. The original
archive `subject`, `course`, and `raw` values remain unchanged, and inherited
rows carry `matched_via: "cross_listed"` so the Past Grades UI can identify the
source listing. The target and source must also have a current-term offering
with the same normalized instructor and the same non-Final meeting day, time,
and location. Exactly one qualifying cross-listed source may have archive rows;
ambiguous multi-source matches remain unavailable rather than being merged.

Exact Course ID records always take precedence. Title similarity and
`May be coscheduled with` text do not qualify: coscheduled undergraduate and
graduate listings can have different grading populations and must not be merged
without a separate authoritative archive relationship.

### TritonGPT CSV section identity continuity (2026-07-22)

Superseded as the preferred source on 2026-08-03: FA26+ schedule data now
comes from the Class Planner API (see the Class Planner Catalog Source
section and ADR 0040). The CSV import below remains a supported fallback.

The stable input contract and column reference live in
[`tritongpt_schedule_csv.md`](tritongpt_schedule_csv.md).

The TritonGPT CSV import reconstructs TSS booking choices from the numeric
groups in `section_code`. A `000` component is shared by each nonzero option in
the same class group, so a lecture plus each discussion or lab remains one
Worksheet-selectable package rather than separate sections.

When replacing an existing term snapshot, pass that snapshot to
`import-tritongpt-schedule-csv.mts` before publishing:

```bash
bun tools/catalog-snapshot/import-tritongpt-schedule-csv.mts \
  --csv-dir TSS_相关资料/chatbot-responses/raw/FA26/csv/<capture> \
  --output-dir TSS_相关资料/chatbot-responses/processed/FA26/<capture> \
  --captured-at <truthful ISO-8601 observation timestamp>
```

The importer automatically reads the published snapshot for the CSV term when
it exists. Package identity reconciliation follows these rules:

1. Source `section_id` or `section_ref` remains the primary component identity.
2. A prior package with the same normalized TSS course code and exact event-ID
   set keeps its existing section-ID suffix.
3. When the current CSV omits source event IDs, the importer may instead match
   the prior package by its normalized `section_code` set.
4. A sparse row is reconciled by `section_code` only when that code maps to at
   most one source component ID. Ambiguous sparse rows fail conversion rather
   than merging components or guessing which package the row belongs to.

This preserves Anonymous Worksheets, Saved Worksheets, and shared Worksheet
URLs across a data refresh while keeping distinct source components separate.

CSV parsing is header-driven. Files and chunks may reorder supported columns,
omit unavailable optional columns, or include unknown extra columns. Explicit
cancellation propagates to overlapping rows for the same resolved component so
an older or sparser chunk cannot republish it. Status validation runs after
that reconciliation: cancelled components are excluded, while an unsupported
status on a publishable row fails conversion. Availability-only rows keep an
empty meeting list instead of inventing schedule data.

The older `--transfer-json` plus `--raw-dir` capture path remains supported.

### Paired Snapshot and Import Manifest publication

The TSS publisher produces one release candidate with matching identity across:

- `api/static/catalogs/public/FA26.json`
- `api/static/catalogs/import-manifests/FA26.json`
- the `FA26` entry in `api/static/metadata.json`

It writes the snapshot and Import Manifest before updating the metadata
registry. The metadata entry must contain
`catalogs/import-manifests/FA26.json`; `manifest_path: null` is not an accepted
Term Archive publication state.

The Import Manifest has one cell for every configured subject and each of the
three sources. Its statuses are evidence, not release-success labels:

- `ok`: the selected source artifact was present and produced rows.
- `empty`: the source was complete for that cell but legitimately produced no
  rows.
- `failed`: no TSS response covered the schedule subject, or the selected
  normalized metadata artifact was missing.
- `partial`: a matching TSS batch reported incomplete coverage, so that
  subject's completeness is unknown even when rows were published.

The Term Archive builder requires the repository snapshot and manifest term
sets to match exactly, checks their term identities, and recalculates the
manifest summary from its cells. This failure is intentional: do not bypass the
validator or create an empty manifest to make a snapshot publishable. Run the
formal publisher again and inspect the truthful cell evidence instead.

Credential-free acceptance commands are:

```bash
bunx vitest run tools/catalog-snapshot/tssPublishedSnapshotPipeline.test.ts \
  tools/staging-deployment/termArchive.test.ts
bun run validate:staging-deployment
bun run validate:production-deployment
```

Passing these checks proves that the repository artifacts are structurally
publishable. It does not change `coverage.complete`, resolve `partial` or
`failed` cells, or authorize a hosted Staging or Production deployment.

## Schedule Parser and Modal Data Notes

This section records Schedule of Classes parser and modal data-shape issues
found while adding exam rows and replaying preserved raw Schedule HTML. These
rules are separate from General Catalog description enrichment, but they affect
the same published snapshot files consumed by the frontend.

### 1. Non-enrolled exam rows are real meetings

UCSD Schedule of Classes may emit exams and other informational meetings as
`nonenrtxt` rows. These rows do not have enrollable Section IDs and should not
show seats, but they still carry real meeting metadata:

- meeting type, such as `FI` Final Exam or `MI` Midterm
- date, stored in the source table's `Section` column
- day, time, building, and room

Parser and UI implication:

- Treat `FI`, `MI`, `RE`, and other instruction/meeting codes as displayable
  meeting rows, not as availability-bearing sections.
- Preserve both parsed dates and raw source text so exam rows can show the
  actual date and time.
- Do not attach seats or waitlist labels to exam/info rows.

### 2. Repeated lecture families can leak shared exam rows

MATH 10B Fall 2025 exposed the sharpest Schedule parser bug. UCSD renders the
same course three times in one table block:

- Section A lecture family with final on `2025-12-12`, `8:00a-10:59a`,
  `LEDDN AUD`
- Section B lecture family with final on `2025-12-11`, `11:30a-2:29p`,
  `MOS 0114`
- Section C lecture family with final on `2025-12-09`, `3:00p-5:59p`,
  `CENTR 101`

The FI rows have no Section ID, and their `Section` column contains the exam
date rather than a code like `A00`. The old parser could not derive an
`A`/`B`/`C` family from the FI row itself, so it treated the row as too broadly
shared. The visible symptom was:

- A sections received A, B, and C finals.
- B sections received B and C finals.
- C sections received only C finals.

Correct rule:

- Track the current explicit lecture family while parsing a course block.
- If a non-enrolled shared/info meeting has no own family, inherit the current
  family instead of attaching to all sections.
- Reset this current-family state when a new course header is parsed.
- Only update family state after confirming the row has a real meeting-type
  marker; text-only non-enrolled rows such as lab-fee notes must not mutate
  parser state.

Regression coverage:

- `tools/catalog-snapshot/scheduleOfClasses.test.ts` includes a repeated-family
  MATH 10B fixture that asserts A, B, and C sections each receive only their own
  final.

### 3. Pre-header notes are not schedule rows

Some UCSD Schedule pages contain text-only note rows before the parser sees the
full course header shape. AIP is the representative example:

- A short `crsheader` row may show only course number and title text.
- A following `nonenrtxt` row may contain eligibility text.
- The full course header with `boldtxt`, restrictions, units, and catalog link
  appears later.
- The first real section row appears only after that full header.

The old parser checked for `currentCourse` before checking whether the row had a
real meeting-type marker. That made a text-only `nonenrtxt` note look like a
section row before a recognized course header, causing:

```text
Schedule section row found before course header for AIP
```

Correct rule:

- First identify whether `sectxt`/`nonenrtxt` has an `insTyp` meeting marker.
- If there is no `insTyp`, treat the row as note text and skip it.
- Only rows with an `insTyp` marker require a current parsed course.
- Do not infer schedule data from pre-header note text.

Related rule:

- If an `insTyp` span has `title=""`, fall back to the visible cell text such as
  `IT`. Empty titles appear in real Schedule pages and should not erase meeting
  type.

Regression coverage:

- `tools/catalog-snapshot/scheduleOfClasses.test.ts` includes an AIP pre-header
  note fixture that asserts the note is ignored and the later internship section
  parses correctly.

### 4. TBA shared meetings still participate in grouping

Some courses have TBA lecture or independent-study meetings that are shared
across sections. These meetings are still real schedule rows even though they do
not have concrete time/location data.

Frontend grouping implication:

- Do not drop shared meetings solely because `is_tba` is true.
- Include meeting date in the modal grouping key so dated meetings do not
  collapse into unrelated rows.

This surfaced in course modal schedule rendering, not as a raw Schedule parser
exception, but it is a snapshot data-shape rule the UI must respect.

### 5. Parser fixes do not update published JSON by themselves

Changing parser code does not mutate `api/static/catalogs/public/*.json`.
Whenever a parser bug is fixed:

1. Re-run the relevant snapshot pipeline, or replay preserved raw source HTML
   through the new parser.
2. Validate the specific affected term/course in the public JSON.
3. Browser-refresh the modal/list view, because the frontend may still hold an
   older fetched catalog JSON until reload.

For the MATH 10B final issue, the targeted repair was to replay the existing
FA25 MATH Schedule raw HTML with the fixed parser, preserve existing General
Catalog and grade metadata, and rewrite the FA25 public snapshot.

For the AIP/header-shape issue, the broader replay became safe only after a
focused parser test proved the raw shape and the dry-run parser pass reported no
remaining parse failures.

### 6. Replay from preserved raw HTML

When the raw Schedule HTML is preserved under `data/raw/<run_id>/`, a parser fix
can be applied without re-fetching live UCSD data:

Operational rule:

- Dry-run every configured term/subject through the new parser first.
- Treat any parse failure as a parser/data-shape bug, not as something to hide
  with fallback JSON.
- Preserve General Catalog and grade metadata when replaying schedule data.
- Replace schedule-derived fields, especially `sections`, with parsed output.
- Append parsed courses that were absent only because the old parser failed
  before producing them.
- Validate public JSON after replay and browser-check at least one formerly
  missing subject/modal.

The 2026-06-29 full replay after the AIP/header-shape fix produced:

| Metric                    | Count |
| ------------------------- | ----: |
| Terms                     |    14 |
| Configured term/subjects  |  1649 |
| Updated term/subjects     |  1649 |
| Failed term/subjects      |     0 |
| Missing raw files         |     0 |
| Replaced existing courses | 14141 |
| Added parsed courses      |  2718 |

The important behavior change was visible in `WI25 AIP`:

- Before the fix: `Showing 0 results`
- After replay: `Showing 47 results`
- `AIP 97` opens a modal with six internship sections

### 7. Verification commands used for recent Schedule parser fixes

Focused parser/data-shape tests:

```bash
bun run vitest run tools/catalog-snapshot/scheduleOfClasses.test.ts \
  frontend/src/components/CourseModal/ucsdSnapshotModalData.test.ts \
  frontend/src/utilities/catalogView.test.ts
```

Project-level checks:

```bash
bun run typecheck
bun run test:snapshot
```

Validate all public snapshots against their embedded term config:

```bash
bun --eval '
const fs = require("fs");
const { validateCatalogSnapshot } = await import("./tools/catalog-snapshot/catalogSnapshot.ts");
const failures = [];
for (const file of fs.readdirSync("api/static/catalogs/public").filter((name) => name.endsWith(".json")).sort()) {
  const snapshot = JSON.parse(fs.readFileSync(`api/static/catalogs/public/${file}`, "utf8"));
  const config = {
    active_planning_term: snapshot.active_planning_term,
    term_label: snapshot.term_label,
    term_date_range: snapshot.term_date_range,
    configured_subjects: snapshot.configured_subjects,
    paths: {
      raw_dir: "data/raw",
      normalized_dir: "data/normalized",
      reports_dir: "data/reports",
      public_catalog_dir: "api/static/catalogs/public",
      metadata_path: "api/static/metadata.json",
    },
  };
  const result = validateCatalogSnapshot(snapshot, config);
  if (!result.success) failures.push({ file, errors: result.errors });
}
console.log(JSON.stringify({ failures }, null, 2));
'
```

Targeted public JSON audit for MATH 10B FA25:

```bash
jq -r '
  .courses[]
  | select(.subject == "MATH" and .course_number == "10B")
  | .sections[]
  | [
      .section_code,
      .raw.raw_section_identifier,
      (
        .meetings
        | map(
            select(.meeting_type == "Final")
            | (.date + ":" + (.raw_days // "") + ":" + (.raw_time // "") + ":" + (.raw_location // ""))
          )
        | join(" | ")
      )
    ]
  | @tsv
' api/static/catalogs/public/FA25.json
```

## Catalog List And Detail Payload Boundary (2026-07-22)

The checked-in `api/static/catalogs/public/*.json` files remain the canonical,
self-contained generation artifacts. They retain
`grade_archive_records` so snapshot validation, archive replay, and enrichment
do not depend on a second source file.

The HTTP and R2 publication boundary now derives two payloads from that
canonical artifact:

- `GET /api/catalog/public/:term` serves the Catalog list payload. Course rows
  keep `archive_record_count` and all list/detail-modal fields except
  `grade_archive_records`.
- `GET /api/catalog/details/:term` serves term identity plus Course ID and
  `grade_archive_records` only.

The frontend fetches the list during Catalog loading. It fetches and caches one
term detail payload only when a user opens a Past Grades tab for a course whose
list row reports archive records. Opening a Course modal on Overview does not
request the detail payload. A failed detail request is not cached and can be
retried.

Local Express and Vite derive and cache both responses from the canonical file.
Worker publication writes separate immutable
`published-snapshots/:term/:digest.json` and
`published-details/:term/:digest.json` objects, verifies both, and then writes
`metadata.json` with `snapshot_path` and `detail_path`. Existing Frozen registry
entries may have `detail_path: null`; their already-published list object remains
valid and can continue to carry embedded records.

## Class Planner Catalog Source (2026-08-03)

UCSD Class Planner (`https://classplanner.apps.ucsd.edu`) exposes the TSS
schedule data behind a public JSON API that needs no SSO login. Its section
ids (`E 00000972`, `EL00002329`) are the same TSS event ids stored in
published snapshot `raw.tss_event_ids`, so it replaces the authenticated TSS
OData export as the schedule source.

Endpoints:

- `GET /api/v1/planner/terms` — term registry with course/section/meeting
  counts and `last_full_refresh_at` (used as the availability timestamp).
- `GET /api/v1/catalog/filters?term_code=FA26` — subjects with course counts
  (used as the `requested_course` subject universe).
- `GET /api/v1/catalog/courses?term_code=FA26&limit=48&offset=N` — paginated
  full catalog with sections and meetings. `limit` is capped at 48 by the
  server.

Pipeline:

```bash
bun tools/classplanner-scraper/fetch-classplanner-catalog.mts --term FA26
bun tools/classplanner-scraper/convert-classplanner-to-tss.mts \
  --run-dir data/raw/classplanner/FA26/<timestamp>
bun tools/catalog-snapshot/generate-tss-published-snapshot.mts \
  --raw-dir data/raw/classplanner/FA26/<timestamp>/tss \
  --metadata-dir data/normalized/multi-2026-06-29T08-02-01.606Z-198ee9a5-ad5c-428b-be61-71951c951b8f-SP26 \
  --metadata-root data/normalized
```

The fetch step preserves every raw page response under
`data/raw/classplanner/<TERM>/<timestamp>/pages/` (gitignored with the rest of
`/data`), plus the merged `courses.json` (`schema_version:
classplanner-catalog-v1`).

The convert step rebuilds tss-chatbot-v1 booking choices from
`event_package_ids`:

- Within one module, a package id is one bookable combination. Ids that repeat
  an instruction type are planner-internal groupings (the Class Planner
  frontend enforces one section per type), and ids whose member set is a
  strict subset of another package are display artifacts; both are dropped.
- Sections without package ids are TSS linked events resolved through the
  `FAMILY-INDEX-TYPE` section-code hierarchy: a `001-001-OT` group joins the
  packages of its `001-001-*` packaged sibling; a group with no packaged
  sibling combines with the sections shared by every multi-member package of
  its family (an overflow lab joins the family lecture); a family with no
  packages at all books as one group.
- Duplicate module entries (topic courses such as `BGSE-205`) merge into one
  course per module before grouping.

Validated on 2026-08-03 against the previous OData-derived FA26 snapshot: the
reconstruction reproduces the booking-choice grouping exactly for 1973 of the
1998 shared courses; every remaining difference traces to a real source change
(events added to or removed from packages after 2026-07-22), not to the
grouping rules. Class Planner also carries live `enrolled` counts, so the
regenerated snapshot no longer needs `capacity_enrollment_supp.txt`.
