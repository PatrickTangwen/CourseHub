# Catalog Snapshot For MVP-1

MVP-1 uses a term-scoped Catalog Snapshot as the frontend's course-data contract rather than making the user path depend on live GraphQL queries. This keeps the UCSD crawler/import work decoupled from the inherited Hasura schema while preserving CourseTable's existing static catalog loading pattern.
