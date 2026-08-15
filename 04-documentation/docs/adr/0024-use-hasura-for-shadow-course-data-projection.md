# Use Hasura For The Shadow Course Data Projection

The UCSD Course Data Platform uses a separately owned Postgres Course Data
Store with committed Hasura metadata as its first shadow query projection.
Hasura exposes only approved public course-data tables and relationships; it
does not connect to or expose the App DB.

This decision extends ADR 0002. Hasura was previously only a candidate because
MVP-1 did not need persistence. It is now selected for the Course Data Platform
shadow path after the file-first Published Snapshot contract proved stable.
Published Snapshot JSON remains the Catalog source of truth and current
frontend path. Hasura does not replace it, and frontend adoption requires a
separate ADR and PRD.

The trade-off is an additional local service and versioned metadata contract.
In return, the project retains the useful upstream Postgres/Hasura operating
model while keeping UCSD ingestion owned by the Snapshot Importer and keeping
account-owned data outside the public schema.
