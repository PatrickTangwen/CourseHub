# Course Data Store

Status: stable architecture and first term-and-course tracer reference.

The Course Data Store is a separately owned Postgres database for public UCSD
course data and import provenance. It is not the App DB: App Users, email
verification records, Saved Searches, and Saved Worksheets are never migrated
into or exposed from this database.

The Published Snapshot remains SunGrid's Catalog source of truth and the React
frontend continues to use the existing static JSON endpoints. The Course Data
Store and Hasura projection are a shadow validation path.

## Tracer boundary

The tracer imports one validated real Supported Term and its scheduled Course
relationships:

```text
Published Snapshot
  -> UCSD Snapshot Importer
  -> Course Data Store
  -> anonymous read-only Hasura query
```

Course Data Store migrations live under `course-data-store/migrations` and use
their own `course_data_migrations` journal. They do not share the App DB Drizzle
migration journal or command.

The importer preserves the existing `active_planning_term` and `course_id`
values as external identities. It validates the complete Published Snapshot
before connecting to Postgres, records the source run ID, generation time, and
SHA-256 artifact fingerprint, and reports bounded created/unchanged/rejected
counts. Re-importing identical bytes is idempotent.

Until issue #92 adds atomic mutable-term replacement, importing a different
artifact for an already accepted Supported Term fails closed. This prevents a
projection from mixing generations or recording provenance for data that was
not promoted.

Sections use the existing term-scoped Section ID. Meetings retain source order,
nullable times and locations, raw source values, and explicit TBA semantics.
Instructors use the exact normalized Snapshot name available at this stage and
are connected to Sections through a many-to-many join, so team teaching is not
flattened. A Section may own zero, one, or many Meetings.

Grade Archive Records remain individual historical rows with their source term,
instructor, GPA, grade buckets, and raw record. The Course Data Store does not
compute or expose a single course-level Average GPA.

The Published Snapshot can mark conservatively inherited cross-listed rows with
`matched_via: "cross_listed"`; see `grade_archive.md`. At commit `76fee87`, the
shadow importer retained the target Course ID and the archive row's original
subject/course fields but did not persist that explicit match field. The dated
parity update below supersedes that historical limitation.

Snapshot Availability Data is one observation per imported Section. Enrolled,
capacity, and waitlist values are stored with the Snapshot generation timestamp
and the Supported Term state at that timestamp (`upcoming`, `active`,
`historical`, or `undated`). Names and documentation deliberately describe
Snapshot observations rather than live seats, tracking, or WebReg data.

Every accepted import includes its matching Import Manifest. Matching is checked against
run ID, generation time, and Supported Term before database mutation. Import
runs retain the Snapshot and Manifest fingerprints, source timestamps, and
grouped Manifest status counts. Individual Manifest cells retain
ok/empty/failed/partial status, reason, attempts, row counts, and artifact
references so incomplete enrichment remains visible. Declared status summaries
are verified against the cells, and cross-term or duplicate cells are rejected.

Committed Hasura metadata lives in `course-data-store/hasura`. Hasura connects
only to the Course Data Store and grants the unauthenticated `anonymous` role
select access to Supported Terms and Courses. The metadata exposes UCSD/SunGrid
names such as `supportedTerms`, `termCode`, `courseId`, and `courseNumber`.
Anonymous select permissions also enforce server-side row limits; the complete
public pagination and term-scoping contract remains owned by issue #94.

## Commands

```sh
COURSE_DATA_STORE_DATABASE_URL=<course-data-postgres-url> \
  bun run course-data:migrate

COURSE_DATA_STORE_DATABASE_URL=<course-data-postgres-url> \
  bun run course-data:import -- \
    api/static/catalogs/public/S326.json \
    api/static/catalogs/import-manifests/S326.json

bun run validate:course-data-tracer
```

The disposable tracer starts an isolated Postgres and Hasura stack, applies the
Course Data Store migration, rejects invalid input before mutation, imports the
real S326 Published Snapshot twice, applies metadata, queries as anonymous,
proves App DB tables are unavailable, and checks stable relationship counts.
S326 supplies real one/many-Meeting, TBA, and team-taught evidence. Because no
current Published Snapshot contains a zero-Meeting Section, the validator also
imports an explicitly labelled boundary fixture to prove that cardinality. It
then proves a failed relationship import leaves the accepted projection
readable. The same tracer queries raw Grade Archive Records, timestamped
Snapshot Availability Data, source/import provenance, and real
ok/empty/failed Manifest cells; an explicitly labelled Manifest fixture covers
the partial status absent from S326. It removes containers and volumes on
success or failure.

## Mutable Published Term imports — 2026-07-11

Issue #92 supersedes the earlier temporary fail-closed rule described above for
an already accepted mutable Supported Term. A different artifact is accepted
only when its `generated_at` is newer and its Snapshot, complete Manifest
matrix, relationships, and replacement lifecycle are valid. Failed or partial
Schedule of Classes cells are rejected before any first promotion or
replacement; non-core enrichment failures remain preserved and queryable in
the Manifest projection.

Same-term importers serialize on a transaction-scoped Postgres advisory lock.
The importer removes the previous term projection and inserts the complete new
projection in one transaction, retaining import-run and Manifest history.
Postgres MVCC therefore keeps the previous complete projection visible to
concurrent Hasura readers until the replacement commits. Any relationship or
database failure rolls the transaction back.

Use `--dry-run` to validate and report grouped created, updated, unchanged,
removed, and rejected counts without mutation:

```sh
COURSE_DATA_STORE_DATABASE_URL=<course-data-postgres-url> \
  bun run course-data:import -- \
    api/static/catalogs/public/S326.json \
    api/static/catalogs/import-manifests/S326.json \
    --dry-run
```

## Frozen Snapshot and Term Archive imports — 2026-07-11

Issue #93 adds an explicit Snapshot lifecycle contract to the importer and
Course Data Store. The caller maps the authoritative Supported Term registry
entry's `frozen` flag to the validated `--lifecycle published|frozen` importer
argument; the importer does not read the registry or infer immutability from
dates. Existing calls default to `published`.

When a term leaves the Term Window, import its unchanged last Published
artifact with `--lifecycle frozen`. This atomically marks the accepted
Supported Term and its import provenance as Frozen while preserving the
original artifact fingerprint and generation timestamp. Snapshot Availability
Data for that term becomes explicitly historical. Identical Frozen re-imports
are idempotent; a lifecycle downgrade or any conflicting Frozen artifact is
rejected without mutation.

```sh
COURSE_DATA_STORE_DATABASE_URL=<course-data-postgres-url> \
  bun run course-data:import -- \
    <frozen-snapshot.json> \
    <matching-import-manifest.json> \
    --lifecycle frozen
```

Course and Section primary identities remain scoped by Supported Term, so
Published and Frozen terms accumulate independently in the Term Archive.
Anonymous Hasura queries expose `termCode` and `snapshotLifecycle` on Supported
Terms and retain the original import generation timestamps. This is a
forward-accumulating archive only; it does not claim unavailable pre-Term-Window
backfill.

## Bounded public GraphQL contract — 2026-07-11

Issue #94 defines the browser-facing `/ferry/v1/graphql` gateway to the
anonymous Hasura role as a deliberately bounded, read-only shadow API. A public
request must contain one query operation and one approved root field. Every
list requires a positive `limit`; term-owned roots also require
`where: {termCode: {_eq: ...}}`. Root limits cannot exceed 100, relationship
limits cannot exceed 20, selection depth cannot exceed six, and request bodies
cannot exceed 64 KiB. A request may select at most 80 fields and 12 relationship
lists across aliases and fragment expansions; fragment cycles are rejected.
Public consumers paginate with GraphQL `limit` and `offset`.

Anonymous Hasura select permissions remain defense-in-depth and apply
server-side maximum row counts even if a caller bypasses or misconfigures the
gateway:

- Supported Terms: 10; Courses and instructors: 100.
- Sections, instructor links, Grade Archive Records, Snapshot Availability,
  and Import Manifest cells: 200.
- Meetings: 250; import runs: 20.

Approved relationships form a finite outward tree: Supported Term to Courses,
import runs, and Manifest cells; Course to Sections and Grade Archive Records;
Section to Meetings, Snapshot Availability, and instructor links; instructor
links to instructors. Reverse Course-to-Term and Section-to-Course
relationships are intentionally absent, preventing recursive relationship
expansion without relying on Hasura Cloud/Enterprise query-depth features.

Anonymous schema introspection is the sole exception to list argument rules so
consumers can discover the shadow contract, but Hasura applies it to the
anonymous role: there is no mutation root and no App DB or inherited Yale
roots. The metadata API and direct Hasura endpoint remain administrative paths
protected by the admin secret. The Course Data Store source connects only to
its own database, so App Users, verification records, Saved Searches, Saved
Worksheets, and Saved Worksheet Sections are absent rather than merely
row-filtered.

The browser-facing Express `/ferry` compatibility proxy always overwrites the
role with `anonymous` and removes any browser-supplied admin-secret header.
Hasura administration and privileged GraphQL clients remain server-side paths;
the frontend receives no Hasura admin credential. The current Catalog frontend
continues to read Published Snapshot JSON and does not use this shadow API.

## Published Snapshot semantic parity acceptance — 2026-07-11

Issue #95 extends `bun run validate:course-data-tracer` into the primary
end-to-end semantic acceptance seam. The command validates and imports the real
S326 Published Snapshot and its accepted Import Manifest, then reads the entire
term projection back through the anonymous browser-facing
`/ferry/v1/graphql` gateway using bounded `limit`/`offset` pages.

The published S326 Manifest contains four historical Schedule parser failures
already handled by the issue #92 tracer fixture. Before import, the acceptance
flow verifies that the failed-cell set is exactly AIP, CAT, MATH, and PSYC,
converts only those known fixture cells to the previously approved empty-cell
state, and rejects any unexpected or missing failure. The resulting acceptance
Manifest bytes—not importer mapper logic—are the oracle for persisted Manifest
status, reason, summary, and fingerprint comparison.

The source artifacts and GraphQL transport are normalized independently into
the Catalog Snapshot domain projection. The comparison covers Supported Term
metadata and lifecycle, Course and Section identities and fields, Meeting
cardinality and TBA values, Section/instructor relationships, raw Grade Archive
Records, timestamped Snapshot Availability Data, import provenance, and every
Import Manifest cell. Ordering, database surrogate keys, JSON object key order,
and GraphQL-only transport shape are intentionally excluded.
The same projection comparison runs after the zero-Meeting boundary term is
transitioned to Frozen, including historical availability state, original
observation timestamp and values, and lifecycle provenance.

Mismatch evidence contains only a bounded list of category, stable identity,
field, and missing/extra/changed classification. The acceptance also injects
intentional missing identity, extra relationship, and changed field probes to
prove the comparator fails materially different projections. The same command
smokes the unchanged static Catalog metadata and Published Snapshot endpoints,
and its existing `finally` cleanup removes the disposable containers, volumes,
gateway processes, and generated secrets on success or failure.

## Cross-listed Grade Archive provenance parity — 2026-07-21

The Course Data Store now persists the Published Snapshot's optional
`matched_via` value on each Grade Archive Record and exposes it as `matchedVia`
through the anonymous Hasura projection. The database constraint accepts only
`cross_listed` or `null`, matching the current Published Snapshot schema rather
than introducing a broader provenance vocabulary.

`bun run validate:course-data-tracer` imports an explicitly labelled
cross-listed boundary record and compares the complete source projection with
the anonymous GraphQL result. The acceptance fails if the importer, migration,
Hasura metadata, or parity query drops the provenance field. This closes the
parity gap recorded at commit `76fee87`; it does not move the Catalog frontend
off the static Published Snapshot path.
