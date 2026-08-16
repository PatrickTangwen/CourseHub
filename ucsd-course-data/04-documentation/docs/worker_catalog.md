# Worker Catalog

Status: local Worker composition and private R2 publication contract.

The first Worker slice serves the React build, Supported Term metadata, and
Published Snapshots from one origin. It does not create or access hosted
Cloudflare resources. The checked-in Wrangler configuration disables
`workers.dev` and preview URLs; local acceptance uses Wrangler's local R2
simulation only.

## Local acceptance

Run:

```sh
bun run validate:worker-catalog
```

The command builds the React application for same-origin API requests, creates
an isolated temporary Wrangler state directory, publishes one accepted fixture
through the production publication module, and starts a local Worker on an
unused loopback port. It verifies:

- React HTML and `/api/catalog/*` share one origin;
- metadata and Snapshot objects are read through the private R2 binding;
- JSON content type, cache control, ETag, and conditional `304` behavior;
- bounded not-found behavior for missing terms, legacy Catalog routes, Ferry,
  and sitemap routes; and
- no `workers.dev` or `r2.dev` URL appears in the accepted surface.

Success and failure both stop the Worker and remove the temporary R2 state.
The command never uses Wrangler's `--remote` option.

Use `bun run build:worker` for a frontend build plus Wrangler dry-run bundle
check. This reads bindings from `worker/wrangler.jsonc` but does not deploy.

## Publication integrity

`publishAcceptedCatalog` receives an explicit acceptance record containing the
term, bytes, expected size, and SHA-256 digest for the Snapshot and Import
Manifest. It validates both JSON artifacts and the Supported Term registry
before the first object write.

Accepted Snapshot and Manifest bytes are written to immutable,
content-addressed keys. `metadata.json` is written last and points to those
keys. A failed object write may leave an unreachable immutable object, but it
cannot change the current Published Snapshot. An unaccepted manifest, size or
digest mismatch, term mismatch, unsafe term, or unsupported term performs no
write.

The publication operation is not exposed as a public Worker route. A later
deployment workflow may provide a controlled R2 adapter without changing the
publication algorithm.

## Runtime files

- `worker/src/catalogWorker.ts`: Worker fetch composition and static-assets
  fallback.
- `worker/src/r2CatalogStore.ts`: private R2 read and publication adapters.
- `worker/src/catalogPublication.ts`: validation and metadata-pointer switch.
- `worker/wrangler.jsonc`: local/staging binding names and public-route safety
  settings.

## List/detail publication update (2026-07-22)

Catalog publication now derives two public payloads from each accepted
self-contained Snapshot before writing R2:

- the list object omits per-course `grade_archive_records`;
- the term detail object contains Course IDs and their grade records.

Both objects are immutable and content-addressed. Publication writes and
verifies the list, detail, and Import Manifest before switching
`metadata.json`. The runtime serves details only from the private R2 path named
by `detail_path` at `/api/catalog/details/:term`; it never derives provider URLs
or exposes the R2 bucket. Frozen metadata created before this change may omit
`detail_path`, in which case the detail route returns not found and the legacy
list payload remains the compatibility source.

`bun run validate:worker-catalog` verifies that the list response excludes the
grade-record field and the details response contains it.
