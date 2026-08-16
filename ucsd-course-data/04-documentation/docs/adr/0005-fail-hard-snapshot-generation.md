# Fail Hard Snapshot Generation

Catalog Snapshot generation fails hard for MVP-1: if any configured subject or core source cannot be fetched or parsed, the command exits non-zero and does not publish a partial snapshot. This favors trustworthy course data over degraded catalog availability, while still preserving raw source snapshots and import reports for debugging.
