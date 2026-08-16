# Store Published Snapshots In R2

Hosted environments will store accepted Published Snapshots and their Import Manifests in private Cloudflare R2 and serve the current snapshot through the App Worker. If the frontend later adopts the bounded GraphQL path, R2 remains the durable publication record, Course Data Store import source, rollback baseline, and parity-audit evidence rather than the primary interactive query path; the GraphQL cutover still requires a separate decision that supersedes the current snapshot-first frontend contract.
