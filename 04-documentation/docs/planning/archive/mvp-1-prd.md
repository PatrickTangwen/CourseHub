# MVP-1 PRD: UCSD Public Catalog And Anonymous Worksheet

## Problem Statement

UCSD students need a fast, trustworthy way to search courses, inspect course details, compare historical GPA outcomes, and build a conflict-aware schedule before committing to official enrollment tools. The current CourseTable fork is shaped around Yale data, Yale evaluation concepts, social features, and optional GraphQL-backed course access, while the UCSD project needs to prove a narrower foundation first.

MVP-1 must validate that public UCSD data sources can produce a reliable term-scoped Catalog Snapshot and that the inherited CourseTable frontend can consume UCSD Course, Section, and Meeting data for catalog search and anonymous schedule planning. It must avoid features that imply real-time enrollment availability, require user accounts, rely on a database, or depend on gated SET/CAPE evaluation access.

## Solution

Build MVP-1 as a public catalog and anonymous worksheet experience backed by a file-first Catalog Snapshot. The snapshot is generated from UCSD Schedule of Classes, UCSD General Catalog, and UCSD Instructor Grade Archive data for the configured subjects `CSE` and `MATH`. The frontend reads the Published Snapshot from static catalog assets and provides catalog search, course detail, local worksheet persistence, share URL restore, conflict detection, and ICS download without login, App DB, Course Data Store, Hasura, or live GraphQL dependency in the user path.

The product should present Historical GPA Data accurately as Average GPA,
Record Count, and Past Grades, not as ratings, workload, professor quality, or
recommendation scores. Average GPA summarizes the most recent matching archive
term with data. Record Count remains archive-depth context across all matching
terms. It should intentionally exclude Availability Data such as open seats,
capacity, waitlist, enrollment, demand, and friends-taking-course signals.

## User Stories

1. As a UCSD student, I want to open the catalog without logging in, so that I can start planning immediately.
2. As a UCSD student, I want the catalog to load from a Published Snapshot, so that course discovery is fast and stable.
3. As a UCSD student, I want to know which Active Planning Term I am viewing, so that I do not plan from the wrong term.
4. As a UCSD student, I want to search by subject, so that I can quickly find CSE or MATH courses.
5. As a UCSD student, I want to search by course number, so that I can find a known course like CSE 101 or MATH 20A.
6. As a UCSD student, I want to search by course title, so that I can discover courses when I only know part of the name.
7. As a UCSD student, I want to search by instructor, so that I can find sections taught by a particular instructor.
8. As a UCSD student, I want to search by description text, so that I can discover courses by topic.
9. As a UCSD student, I want to filter by subject, so that I can focus on one configured subject at a time.
10. As a UCSD student, I want to filter by course level, so that I can separate lower division, upper division, and graduate courses.
11. As a UCSD student, I want to filter by meeting day, so that I can avoid days when I cannot take classes.
12. As a UCSD student, I want to filter by time range, so that I can avoid early, late, or otherwise unavailable times.
13. As a UCSD student, I want to filter by meeting type, so that I can distinguish lectures, discussions, labs, and similar section types.
14. As a UCSD student, I want to filter by Average GPA, so that I can compare historical grading outcomes.
15. As a UCSD student, I want to hide courses that conflict with my current Anonymous Worksheet, so that I can build a schedule efficiently.
16. As a UCSD student, I want to sort by course code, so that I can browse courses in a familiar catalog order.
17. As a UCSD student, I want to sort by title, so that I can scan courses alphabetically.
18. As a UCSD student, I want to sort by meeting time, so that I can compare schedule fit.
19. As a UCSD student, I want to sort by Average GPA, so that I can compare historical GPA outcomes.
20. As a UCSD student, I want to sort by Record Count, so that I can see which GPA summaries have more archive records.
21. As a UCSD student, I want the catalog to avoid open-seat wording, so that I do not mistake the tool for WebReg availability.
22. As a UCSD student, I want the catalog to avoid enrollment and waitlist claims, so that I understand it is a planning tool.
23. As a UCSD student, I want to open a Course detail view, so that I can inspect more information before adding a Section.
24. As a UCSD student, I want Course detail to show title and units, so that I understand what the course is.
25. As a UCSD student, I want Course detail to show General Catalog description, so that I can evaluate course content.
26. As a UCSD student, I want Course detail to show raw prerequisites text, so that I can check requirements myself.
27. As a UCSD student, I want Course detail to show restrictions text when available, so that I can spot enrollment constraints.
28. As a UCSD student, I want Course detail to show the catalog source URL, so that I can verify official source context.
29. As a UCSD student, I want Course detail to list Sections, so that I can choose a scheduled offering.
30. As a UCSD student, I want each Section to show instructors, so that I can evaluate who is teaching it.
31. As a UCSD student, I want each Section to show Meetings, so that I can understand its weekly schedule.
32. As a UCSD student, I want each Meeting to show building and room text, so that I can plan where classes happen.
33. As a UCSD student, I want TBA or arranged Meetings to be visible, so that missing times are not hidden.
34. As a UCSD student, I want TBA or arranged Meetings to be excluded from conflict checks, so that the app does not invent a conflict.
35. As a UCSD student, I want Course detail Overview to show Average GPA, so that I can see the most recent available historical grading outcome.
36. As a UCSD student, I want Course detail to provide a Past Grades tab, so that raw archive rows are separated from overview metadata.
37. As a UCSD student, I want Past Grades to show raw Grade Archive Records, so that I can inspect year, quarter, instructor, GPA, and grade-bucket percentages myself.
38. As a UCSD student, I want the app to avoid calling GPA a rating, so that I do not confuse grading outcomes with quality or workload.
39. As a UCSD student, I want to add a Section to an Anonymous Worksheet, so that I can build a schedule.
40. As a UCSD student, I want to remove a Section from an Anonymous Worksheet, so that I can revise my plan.
41. As a UCSD student, I want my Anonymous Worksheet to persist in my browser, so that a refresh does not lose my plan.
42. As a UCSD student, I want worksheet identity to use Section IDs, so that sections restore predictably even when display text changes.
43. As a UCSD student, I want a share URL for my Anonymous Worksheet, so that I can send a planned schedule to myself or someone else.
44. As a UCSD student, I want the share URL to restore Sections from the Catalog Snapshot, so that no server-side share record is required.
45. As a UCSD student, I want missing Section IDs in a share URL to show a warning, so that stale links do not crash the app.
46. As a UCSD student, I want conflicts to be visible, so that I can decide whether a schedule is workable.
47. As a UCSD student, I want conflicts not to block adding Sections, so that I can compare alternatives before choosing.
48. As a UCSD student, I want multi-meeting Sections to participate in conflict detection, so that discussions, labs, and lectures are all considered.
49. As a UCSD student, I want to download an ICS file, so that I can view the planned schedule in an external calendar.
50. As a UCSD student, I want ICS export to include timed Meetings, so that calendar events match the selected Sections.
51. As a UCSD student, I want ICS export to skip TBA or arranged Meetings with a clear skipped count, so that I understand what was omitted.
52. As a UCSD student, I want ICS export to use the configured Term Date Range, so that repeated events align with the UCSD term.
53. As a UCSD student, I want conflicts not to block ICS export, so that I can export a draft plan.
54. As a project maintainer, I want snapshot generation to be one-command, so that MVP data refresh is repeatable.
55. As a project maintainer, I want configured subjects to live in configuration, so that adding a subject later does not require changing parser logic.
56. As a project maintainer, I want raw UCSD source snapshots preserved, so that parser bugs can be debugged from evidence.
57. As a project maintainer, I want normalized artifacts generated before publication, so that source parsing and frontend consumption are decoupled.
58. As a project maintainer, I want snapshot validation before publication, so that broken data does not reach users.
59. As a project maintainer, I want snapshot publication to be atomic, so that a failed run does not overwrite the last good Published Snapshot.
60. As a project maintainer, I want generation to fail hard on any configured subject or core source failure, so that partial snapshots are never silently published.
61. As a project maintainer, I want import reports with source timestamps and run IDs, so that data freshness and provenance are visible.
62. As a project maintainer, I want validation to reject Availability Data fields, so that excluded product directions do not leak into the snapshot.
63. As a project maintainer, I want validation to reject friends and evaluation fields, so that Yale-specific concepts do not remain in the MVP user path.
64. As a project maintainer, I want stable Course IDs, so that catalog-level data merges reliably.
65. As a project maintainer, I want stable Section IDs, so that worksheet and share URL restore behavior is reliable.
66. As a project maintainer, I want raw source values preserved alongside normalized values, so that normalization bugs can be investigated.
67. As a project maintainer, I want parser fixture tests for CSE and MATH, so that the two MVP subjects are covered by repeatable evidence.
68. As a project maintainer, I want frontend behavior tests for catalog and worksheet flows, so that the MVP user path remains stable after refactors.
69. As a project maintainer, I want the MVP to avoid database and Hasura requirements, so that the first release validates the data contract before adding infrastructure.
70. As a project maintainer, I want post-MVP database and Hasura decisions documented separately, so that future persistence work does not distort MVP scope.

## Implementation Decisions

- MVP-1 is defined as public catalog plus Anonymous Worksheet. It is not a full CourseTable clone.
- The frontend course-data contract is a term-scoped Catalog Snapshot, not live GraphQL queries.
- The Published Snapshot is the only course data source used by MVP-1 user paths.
- MVP-1 uses a file-first pipeline. It does not require Postgres, Hasura, an App DB, or a Course Data Store.
- Future persistence is staged after MVP-1: Beta-1 may add an App DB for auth and saved user data, and later work may add a Course Data Store. Hasura remains optional and must be justified by a future ADR before adoption.
- MVP-1 supports only the configured subjects `CSE` and `MATH`.
- Config controls the Active Planning Term, term label, Term Date Range, configured subjects, source output locations, and published metadata.
- UCSD Schedule of Classes is used for Active Planning Term Courses, Sections, Meetings, instructors, and building/room text.
- UCSD General Catalog is used for title, units, description, raw prerequisites text, raw restrictions text, and catalog source URLs.
- UCSD Instructor Grade Archive is the primary Historical GPA Data source.
- Starter CSV files are not the MVP-1 primary GPA source.
- Instructor Grade Archive rows are modeled as Grade Archive Records.
- Average GPA is the unweighted mean of matching Grade Archive Records from the most recent archive term that has data.
- Record Count is the total number of matching Grade Archive Records across all terms.
- Grade-bucket values from the Instructor Grade Archive are treated as percentages, not counts.
- No weighted GPA, sample size, student count, rating, workload, professor quality, or recommendation score is derived from Historical GPA Data.
- Course ID is based on normalized subject plus course number.
- Section ID is based on Active Planning Term plus the UCSD source section identifier.
- Worksheet state and share URLs store Section IDs only.
- Raw source values are preserved for debugging and audit.
- Cross-listed Courses are not auto-merged in MVP-1 unless a reliable official source is introduced later.
- A Section may have zero, one, or many Meetings.
- Timed Meetings participate in conflict detection and ICS export.
- TBA or arranged Meetings are displayed but excluded from conflict detection and ICS export.
- Catalog search covers subject, course number, title, instructor, and description.
- Catalog filters include subject, course level, days, time range, meeting type, Average GPA range, and hide-conflicts.
- Catalog sorting includes course code, title, meeting time, Average GPA, and Record Count.
- MVP-1 has one primary catalog list/table view.
- Course detail Overview shows schedule data, catalog metadata, raw prerequisite/restriction text, Average GPA, and source timestamps where available; raw Grade Archive Records live in the Past Grades tab.
- Anonymous Worksheet supports add, remove, browser local persistence, share URL restore, conflict detection, and ICS download.
- Share URL restore is snapshot-backed and creates no server-side share record.
- Missing Section IDs in share URLs produce non-blocking warnings and must not crash the page.
- ICS export includes selected Sections' timed Meetings, uses the configured Term Date Range, skips TBA/arranged Meetings, and reports skipped Meetings.
- Snapshot generation follows fetch raw source, save raw snapshots, parse normalized artifacts, merge by Course ID and Section ID, generate staging snapshot, validate, atomically publish, and write import report.
- Snapshot generation fails hard if any configured subject or core source cannot be fetched or parsed.
- Failed validation must not overwrite the previous Published Snapshot.
- Validation must reject missing stable Section IDs, missing configured subjects, schema violations, excluded Availability Data, demand fields, friends fields, and evaluation fields.
- Published metadata must include run identity, generation time, source timestamps, and enough provenance for debugging.

## Testing Decisions

- Tests should verify external behavior and contracts, not parser internals or UI implementation details.
- The highest-value test seams are source parser fixtures, Catalog Snapshot validation/publication, and frontend behavior against a Published Snapshot.
- Parser fixture tests should cover Schedule of Classes, General Catalog, and Instructor Grade Archive for both `CSE` and `MATH`.
- Parser fixture tests should include TBA/arranged Meetings, multi-meeting Sections, missing instructor, missing or malformed GPA, and raw source text preservation.
- Snapshot validation tests should prove that valid snapshots pass and invalid snapshots fail before publication.
- Snapshot validation tests should reject missing Section IDs, missing configured subjects, partial generation, schema violations, and excluded Availability Data fields.
- Snapshot publication tests should prove that a failed validation preserves the existing Published Snapshot.
- Frontend behavior tests should prove that the catalog loads from the Catalog Snapshot without login, App DB, Course Data Store, Hasura, or live GraphQL dependency.
- Frontend behavior tests should cover keyword search, subject filter, course level filter, days/time filtering, meeting type filtering, Average GPA filtering, and sorting.
- Frontend behavior tests should cover hide-conflicts behavior using an Anonymous Worksheet.
- Frontend behavior tests should cover Course detail display for catalog metadata, schedule data, Average GPA, Past Grades raw Grade Archive Records, TBA/arranged Meetings, and source timestamps.
- Worksheet behavior tests should cover add/remove Section, local browser persistence, share URL restore, stale/missing Section ID warning, and conflict visibility.
- ICS tests should cover timed Meeting export, TBA/arranged skipped summary, Term Date Range usage, and exporting a worksheet that contains conflicts.
- Smoke testing should verify that MVP user paths contain no Yale, friends, evals, availability, enrollment, waitlist, demand, Google Calendar direct export, login, or saved-user-data wording.
- The testing seams were already settled through the planning/spec process; this PRD does not require another user interview before issue creation.

## Out of Scope

- Login or user accounts.
- App DB.
- Course Data Store.
- Hasura user-path dependency.
- Live GraphQL course-data dependency.
- Saved worksheets.
- Saved searches.
- Wishlist.
- Profile and privacy settings.
- Friend features, friend counts, friend worksheet views, or friends taking course.
- UCSD college GE mapping UI.
- Full degree audit.
- Major planning.
- Prerequisite eligibility logic or prerequisite graph.
- SET/CAPE integration.
- Professor evaluation pages.
- Evaluation narratives.
- AI evaluation summaries.
- Personal UCSD account based scraping.
- Google Calendar direct export.
- PNG export.
- Multi-term schedule browsing.
- Open seats.
- Seat availability.
- Seat availability history.
- Waitlist availability.
- Capacity or enrollment tracking.
- Real-time WebReg availability.
- Worksheet demand or “in main worksheets” signals.
- Course ratings, workload, professor quality, or recommendation scoring from GPA data.
- Course auto-merge for cross-listed courses without reliable official source evidence.

## Further Notes

- MVP-1 completion means one-command snapshot generation succeeds for `CSE` and `MATH`, the Published Snapshot excludes disallowed fields, catalog and worksheet user paths work without login or database infrastructure, and parser/snapshot/frontend behavior tests pass.
- Post-MVP work should begin only after MVP-1 proves the Catalog Snapshot contract and anonymous planning flow. The first likely follow-up is Beta-1 App DB and Auth for saved worksheets, saved searches, wishlist, and privacy settings.
- Hasura is not rejected permanently. It is deferred until a later Course Data Store decision point, where it should be adopted only if it clearly improves GraphQL compatibility, type generation, admin inspection, or rich query needs.
- GE mapping is not rejected permanently. It is deferred as a separate advisory data product with source URLs, academic-year versioning, and no degree-audit claim.
- SET/CAPE is not rejected permanently. It is deferred until access policy, caching, request budgets, and source-update display are explicitly documented. It must never be fetched live during user browsing.
- Future issues should be split in this rough order: project setup/config, Instructor Grade Archive crawler/parser, General Catalog parser, Schedule parser, snapshot schema/validator/publisher, frontend snapshot adapter, catalog MVP cleanup, Anonymous Worksheet/share URL, conflict detection/ICS export, and polish/smoke tests/docs.
