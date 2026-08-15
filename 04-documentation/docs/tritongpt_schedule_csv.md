# TritonGPT Schedule CSV Reference

Status: stable fallback input contract for SunGrid catalog snapshot imports.
Since 2026-08-03 the preferred FA26-and-later source is the public Class
Planner API scraper (`tools/classplanner-scraper/`, see
`snapshot_pipe.md` Class Planner Catalog Source and ADR 0040).

Use this document when raw schedule data was extracted from TritonGPT as CSV,
for example if the Class Planner API becomes unavailable. The older browser
transfer JSON remains supported only as a capture adapter.

## Header Contract

Every CSV file must have a header row, but columns may be reordered, omitted
when unavailable, or extended with source-specific columns. The importer
matches supported fields by normalized header name (case-insensitive; spaces
and hyphens are treated as underscores) and ignores unknown columns. Each
chunk may use a different column order or supported subset.

The smallest useful row must provide `term_code`, `section_code`, and course
identity as either `subject_code` plus `course_code`, or a parseable
`module_code` such as `BENG-002`. Availability and meeting columns are optional.

The original 23-column export remains supported:

```csv
term_code,subject_code,course_code,class_name,course_title,academic_level,section_id,section_ref,section_code,instruction_type_name,instructors_text,seats_available,waitlist_available,meeting_kind,day_code,day_name,specific_date,start_time_display,end_time_display,building_code,room_code,is_remote,is_tba
```

## Column Reference

| Column                  | Meaning                                                                                                                                                                                 |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `term_code`             | Academic term, such as `FA26` for Fall 2026 or `WI27` for Winter 2027. One import must contain exactly one term.                                                                        |
| `subject_code`          | Department or subject abbreviation, such as `CSE`, `MATH`, or `BILD`.                                                                                                                   |
| `course_code`           | Course number within the subject, such as `008A`, `010A`, or `001`. Together with `subject_code`, this identifies a course such as `CSE-008A`. Preserve leading zeroes from the source. |
| `class_name`            | Catalog-style course label, usually subject plus course number, such as `CSE 8A`.                                                                                                       |
| `course_title`          | Official course title.                                                                                                                                                                  |
| `academic_level`        | Course-level bucket: `LD` for lower division, `UD` for upper division, or `GR` for graduate/professional.                                                                               |
| `section_id`            | Internal identifier for one instructional component.                                                                                                                                    |
| `section_ref`           | Term-specific reference that uniquely identifies the component in that term. Rows for multiple meetings of the same component reuse it.                                                 |
| `section_code`          | Component code describing its class family, option, and instructional type, for example `001-000-LE` or `001-001-DI`.                                                                   |
| `instruction_type_name` | Instructional component type, such as `lecture`, `discussion`, `lab`, `seminar`, `studio`, or `independent study`.                                                                      |
| `instructors_text`      | Instructor name or names displayed by the schedule source.                                                                                                                              |
| `seats_available`       | Open seats observed for the component, when provided. This is snapshot data, not a live guarantee.                                                                                      |
| `waitlist_available`    | Available waitlist spots, when the section supports a waitlist and the source provides the value.                                                                                       |
| `module_code`           | Combined course identity, such as `BENG-002`. It replaces `subject_code` plus `course_code` when those columns are absent.                                                              |
| `capacity`              | Component enrollment capacity.                                                                                                                                                          |
| `enrolled`              | Current component enrollment.                                                                                                                                                           |
| `waitlist_capacity`     | Component waitlist capacity.                                                                                                                                                            |
| `waitlist_enrolled`     | Current number of students on the component waitlist.                                                                                                                                   |
| `status`                | Source status. On publishable rows, blank is unknown and `AC`/`Active` normalize to `AC`; any other value fails conversion. Explicitly cancelled rows are excluded before publication.  |
| `is_cancelled`          | Explicit cancellation flag. True values are `1`, `true`, `yes`, and `y`; a true value excludes all overlapping rows for that component and they are counted in the conversion report.   |
| `meeting_kind`          | Meeting role: normally `class`, but may be `midterm` or `final`.                                                                                                                        |
| `day_code`              | One-letter meeting day: `M`, `T`, `W`, `R`, `F`, `S`, or `U`.                                                                                                                           |
| `day_name`              | Full day name, such as `Monday` or `Thursday`.                                                                                                                                          |
| `specific_date`         | Calendar date for a one-time meeting such as a midterm or final. Recurring weekly meetings normally leave it blank.                                                                     |
| `start_time_display`    | Display-form start time, such as `9:30am`.                                                                                                                                              |
| `end_time_display`      | Display-form end time, such as `10:50am`.                                                                                                                                               |
| `building_code`         | Scheduled building abbreviation.                                                                                                                                                        |
| `room_code`             | Displayed room, commonly including building and room number.                                                                                                                            |
| `is_remote`             | Remote/online indicator. `1` means remote and `0` means not remote.                                                                                                                     |
| `is_tba`                | TBA indicator for time or location. `1` means TBA and `0` means not TBA.                                                                                                                |

## Row And Package Semantics

Each row normally represents one meeting, not an entire course or selectable
package. A component can therefore have separate rows for each recurring day,
a midterm, and a final. Rows with the same `section_ref` are consolidated into
one component while preserving distinct meetings. If `section_id` and
`section_ref` are absent, `section_code` is used as component identity. A prior
snapshot is also matched by the package's section-code signature so its stable
Worksheet ID can be retained. Sparse rows are matched by `section_code` only
when that code maps to at most one source component ID; ambiguous sparse rows
fail conversion rather than merging distinct components.

`meeting_kind` and `specific_date` must remain separate:

- `class` is a recurring class meeting.
- `midterm` is a one-time exam meeting.
- `final` is a final-exam meeting.
- A populated `specific_date` normally identifies a dated one-time event; it
  must not be converted into a recurring weekly meeting.

The numeric segments of `section_code` reconstruct selectable packages:

- The first segment is the class family.
- A `000` second segment is shared by the nonzero options in that family.
- Components with the same nonzero option belong to the same choice.
- For example, `001-000-LE` plus `001-001-DI` is one Lecture/Discussion
  package, while `001-000-LE` plus `001-002-DI` is another package.
- Different component types with the same option, such as `001-001-DI` and
  `001-001-LA`, remain together in that option.

This package reconstruction is part of the Worksheet identity contract. Do not
publish each component as an independent selectable section.

## Producer Quirks And Integrity Rules

Flexible exports support standard CSV quoting for single-line values that
contain commas. Quoted multiline fields are not part of this input contract. The
legacy exact 23-column export may contain an unquoted comma inside
`course_title` or `instructors_text`; for that exact legacy header only, the
importer retains its producer-specific recovery based on the stable
`academic_level`/`section_id` anchor and fixed meeting tail.

The importer may reuse a non-empty component-level availability value when one
meeting row omits it. It may also derive a missing instructional type from a
recognized `section_code` suffix. `seats_available` is authoritative; the
importer does not require it to equal `capacity - enrolled`, and it does not
infer one field from the others. It must not fabricate missing meetings,
course titles, courses, subjects, seats, waitlists, or TBA state. An
availability-only row therefore produces an empty meetings array while keeping
`instructors_text` at component level. Malformed rows and expected subjects
without rows keep coverage incomplete and are recorded in the conversion
report.

Exact duplicate rows across overlapping TritonGPT chunks are removed. Other
rows are retained unless they fail structural validation.

## CSV-First Import

Place one or more `.csv` files in a directory. Filenames are read in natural
sort order, and non-CSV files are ignored.

```bash
bun tools/catalog-snapshot/import-tritongpt-schedule-csv.mts \
  --csv-dir TSS_相关资料/chatbot-responses/raw/FA26/csv/<capture> \
  --output-dir TSS_相关资料/chatbot-responses/processed/FA26/<capture> \
  --captured-at <truthful ISO-8601 observation timestamp> \
  --source-url <optional TritonGPT chat URL> \
  --chat-id <optional TritonGPT chat ID>
```

`--captured-at` is required unless an existing raw-directory `manifest.json`
already records the observation timestamp. A rerun also preserves that
manifest's `source_url` and `chat_id` unless explicit replacements are passed.
The importer never substitutes processing time for observation time.

By default the importer reads
`api/static/catalogs/public/<term>.json` when it exists. That prior snapshot
supplies the expected subject set and preserves section IDs for the same exact
TSS course/event package. Use `--previous-snapshot <path>` to select another
baseline. Without a previous snapshot, `--expected-subjects-file <path>` is
required so a partial scrape cannot define its own incomplete subject universe
as complete. Use `--no-previous-snapshot` to disable ID inheritance for a
first-term import or isolated test, not to bypass subject coverage evidence.

The command writes or refreshes:

- the raw-directory `manifest.json`, including hashes and input provenance;
- `schedule.json` in the processed output directory;
- `reports/conversion-report.json` in the processed output directory.

This command does not publish or deploy. After reviewing the conversion report,
use the formal publisher described in [snapshot_pipe.md](snapshot_pipe.md).

## Legacy Transfer Input

Browser extraction can still pass `--transfer-json <file>` instead of
`--csv-dir`. In that mode, `--raw-dir` is required and the importer writes the
embedded chunks as numbered CSV files. Both input modes use the same parser,
package reconstruction, integrity rules, and output contract.
