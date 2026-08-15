# Worker Account Planning Data

Status: local implementation and contract acceptance for issue #113. Hosted
provider provisioning remains human-owned work.

## Runtime shape

The Worker serves Saved Search and Saved Worksheet requests from the product
origin under `/api/savedSearches*` and `/api/savedWorksheets*`. Node and Worker
both call the same transport-neutral planning-data module, so authentication,
validation, response codes, and App User ID ownership rules have one
implementation.

The Worker creates one Postgres.js client per account request from the existing
cache-disabled `APP_DB_HYPERDRIVE_NO_CACHE` binding. That client supplies the
UCSD auth, Saved Search, and Saved Worksheet stores over the same App DB and is
closed through `ExecutionContext.waitUntil`. The client remains limited to five
connections with type fetching disabled and prepared statements enabled, as
documented for Postgres.js over Hyperdrive.

All Saved Search and Saved Worksheet store operations receive the authenticated
App User ID. Email local-parts and inherited `netId` values are not ownership
keys. Cross-user reads and mutations return the same not-found responses as the
Node backend, so callers cannot distinguish another user's record from a
missing record.

## Session and failure behavior

Planning-data reads resolve the existing fixed Upstash Session with `GET` only.
They do not emit a new Cookie or extend the Redis TTL. Logout deletes the
server-side Session, and replaying the previous Cookie cannot read or mutate
account-owned records.

Missing or unavailable Neon/Hyperdrive, Upstash, or email-provider account
configuration returns a bounded, non-cached `503` for account routes. Static
assets, the public Catalog, and the browser-local Anonymous Worksheet continue
through the independent catalog/assets path.

## Local acceptance

No hosted provider resource or credential is required for the contract tests:

```sh
bun run --cwd api test
bun run test:worker
bun run typecheck
bun run build:worker
bun run validate:worker-catalog
bun run validate:core-backend
```

The shared external contract runs through the actual Node and Worker
composition roots. It covers anonymous rejection, create/read/update/remove
behavior, cross-user isolation, refresh without Session renewal, logout replay
rejection, and App User ID ownership. Focused Worker tests preserve the public
Anonymous Worksheet when individual account bindings are absent.

Provider provisioning and cache policy remain as documented in
`worker_login.md`; this issue does not create or modify Cloudflare, Neon,
Upstash, or Resend resources.
