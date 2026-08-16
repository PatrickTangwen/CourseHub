# File-First MVP With Deferred Persistence

MVP-1 uses a file-first pipeline: UCSD source data is fetched, normalized, and emitted as Catalog Snapshot files consumed by the frontend. MVP-1 does not require Postgres, Hasura, or any live database-backed course query in the user path.

Future persistence is still expected, but it is staged. Beta-1 should introduce an App DB for signed-in users, saved worksheets, saved searches, wishlist, and privacy settings. A normalized Course Data Store may be introduced later for import history, multi-term data, audit reports, and richer queries. Hasura remains a candidate implementation for that Course Data Store, not a committed requirement.
