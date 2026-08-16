# MVP-1 Non-UI Acceptance - 2026-06-20

This note records the issue #11 acceptance pass. It is intentionally additive:
prior planning docs remain historical records.

## Scope

Issue #11 is a non-UI contract and acceptance pass. Visible frontend layout,
copy, controls, and interaction flows were not changed here. Any user-visible
cleanup gap found below is follow-up scope.

## Active Planning Term

`FA26` was the tracer term from the earlier local fixture, but UCSD Schedule of
Classes did not expose CSE or MATH for `FA26` on 2026-06-20. The acceptance
config now uses `S126`, UCSD's Summer Session I 2026 term, because the live
Schedule term list exposes CSE and MATH for that term and Session I has one
coherent date range.

Official date reference:

- https://summersession.ucsd.edu/calendar/

Configured values:

- Active Planning Term: `S126`
- Term label: `Summer Session I 2026`
- Term Date Range: `2026-06-29` through `2026-08-01`
- Configured Subjects: `CSE`, `MATH`

## Snapshot Generation

Run from the repo root:

```bash
bun run snapshot:publish
```

Observed result on 2026-06-20:

- Status: `published`
- Snapshot path: `api/static/catalogs/public/S126.json`
- Metadata path: `api/static/metadata.json`
- Import report path:
  `data/reports/published-2026-06-20T06-23-06-643Z-fdf71695-a7f5-48ef-9a30-e94691b0115d.import-report.json`
- Schedule rows: 15 courses, 22 sections, 44 meetings
- General Catalog rows: 436 courses
- Instructor Grade Archive rows: 2816 records
- Validation: success, no errors

The `data/` import artifacts are local generated evidence and are ignored by
git. The public snapshot JSON and metadata are also generated static artifacts
under the existing `api/static/**/*.json` ignore rule.

## Published Snapshot Contract

The Published Snapshot validator rejects excluded public field names across
snake case, kebab case, and camel case. The excluded contract covers:

- Availability Data: availability, seats, capacity, enrollment, waitlist
- Demand
- Friends and friend counts
- Evaluation, SET/CAPE/OCE, rating, workload, and professor-quality fields

Verification command used after publishing:

```bash
jq '[paths(scalars) | map(tostring) | join(".")]
  | map(select(test("(?i)(availability|available_seats|demand|friend|eval|cape|set|rating|workload|enrollment|enrolled|waitlist|capacity|open_seats|seats_available|seat_availability|seats_limit|professor_quality|professor_rating)")))
  | unique' api/static/catalogs/public/S126.json
```

Observed result:

```json
[]
```

## Test Commands

Focused parser and snapshot contract tests:

```bash
bun run test:snapshot
```

Observed result: 5 test files passed, 27 tests passed.

Focused core frontend behavior tests:

```bash
bun run --cwd frontend test \
  src/queries/ucsdCatalogSnapshot.test.ts \
  src/search/searchTextMatch.test.ts \
  src/utilities/anonymousWorksheet.test.ts \
  src/utilities/calendar.test.ts \
  src/utilities/catalogFreshness.test.ts \
  src/utilities/course.test.ts \
  src/utilities/courseSeason.test.ts \
  src/utilities/modalHistoryUrl.test.ts
```

Observed result: 8 test files passed, 43 tests passed.

Full verification:

```bash
bun run typecheck
bun run checks
git diff --check
```

Observed `bun run checks` result: passed. Lint reported the existing 19 warnings
and 0 errors, then the full snapshot and frontend test suites passed.

## Non-UI Smoke Notes

Smoke paths inspected against local servers:

- Frontend: `http://127.0.0.1:3002`
- Static catalog API: `http://127.0.0.1:4177`
- `/catalog`
- `/worksheet`
- `/catalog?course-modal=S126-3612034979`

Keyword results:

| Keyword                       | `/catalog`   | `/worksheet` | Course modal |
| ----------------------------- | ------------ | ------------ | ------------ |
| Yale                          | Not observed | Not observed | Not observed |
| OCE                           | Not observed | Not observed | Not observed |
| SET/CAPE live fetch wording   | Not observed | Not observed | Not observed |
| friends                       | Not observed | Not observed | Not observed |
| friend counts                 | Not observed | Not observed | Not observed |
| syllabus                      | Not observed | Not observed | Not observed |
| maps                          | Not observed | Not observed | Not observed |
| walking time                  | Not observed | Not observed | Not observed |
| login                         | Not observed | Not observed | Not observed |
| saved worksheet               | Not observed | Not observed | Not observed |
| saved search                  | Not observed | Not observed | Not observed |
| wishlist                      | Not observed | Not observed | Not observed |
| Google Calendar direct export | Not observed | Not observed | Not observed |
| open seats                    | Not observed | Not observed | Not observed |
| seat availability             | Not observed | Not observed | Not observed |
| enrollment                    | Not observed | Not observed | Not observed |
| waitlist                      | Not observed | Not observed | Not observed |
| capacity                      | Not observed | Not observed | Not observed |
| demand                        | Not observed | Not observed | Not observed |
| rating                        | Not observed | Not observed | Not observed |
| workload                      | Observed     | Not observed | Observed     |
| professor quality             | Not observed | Not observed | Not observed |

## Follow-Up UI Scope

The catalog and course modal still expose inherited `Workload` wording. This
issue records that as follow-up UI cleanup instead of changing visible UI.

Source inventory also still contains inherited code paths for ratings/evals,
friends, wishlist, syllabus, maps, walking time, login, saved searches, saved
worksheets, and Google Calendar. Those are not part of this non-UI issue unless
a future UI cleanup issue explicitly scopes their removal.
