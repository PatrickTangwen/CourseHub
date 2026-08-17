# Context Map

## Contexts

- [CourseHub Assistant](./CONTEXT.md) — multi-agent Q&A assistant that answers UCSD course questions (backend in `backend/`)
- [SunGrid Course Data](./ucsd-course-data/04-documentation/repository-root/CONTEXT.md) — the UCSD course-data platform whose published catalog snapshots CourseHub consumes

## Relationships

- **SunGrid → CourseHub**: CourseHub ingests SunGrid's published Catalog Snapshots (`ucsd-course-data/01-current-published-data/api/static/catalogs/public/*.json`) as its only knowledge source. Data-layer terms (Term, Course, Section, Meeting, Grade Archive Record, Snapshot Availability Data) are defined in the SunGrid glossary and reused verbatim in CourseHub.
- **Constraint inheritance**: SunGrid's answer-safety rules bind CourseHub's replies — availability numbers must carry the snapshot timestamp and never read as live; no single course-level GPA summary (SunGrid ADR-0014); missing descriptions are stated as missing, never invented.
