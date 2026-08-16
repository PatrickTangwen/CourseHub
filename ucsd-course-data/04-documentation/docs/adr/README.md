# ADR Index

Status: module boundary for architecture decision records.

ADRs record durable decisions and their trade-offs. They should stay small
enough to scan quickly and should point to detailed validation plans, runbooks,
or acceptance records instead of duplicating them.

## ADR Interface

An ADR should answer:

- What decision was made.
- Why the decision exists.
- What scope it applies to.
- What trade-offs or consequences matter later.
- Where detailed execution or validation docs live, when those details exist.

Avoid putting command runbooks, issue checklists, per-run evidence, screenshots,
logs, or transient setup notes directly in ADRs.

## Existing Records

- `0001-catalog-snapshot-for-mvp-1.md`: catalog snapshot approach for MVP-1.
- `0002-file-first-mvp-with-deferred-persistence.md`: file-first MVP with
  deferred persistence.
- `0003-instructor-grade-archive-for-historical-gpa.md`: instructor grade
  archive as the historical GPA source.
- `0004-exclude-availability-and-demand-data.md`: exclusion of availability and
  demand data.
- `0005-fail-hard-snapshot-generation.md`: fail-hard snapshot generation.
- `0006-hard-disable-inherited-ui-before-deleting-backend-surfaces.md`: hard
  disable inherited UI before deleting reusable backend surfaces.
- `0007-email-verification-for-first-ucsd-auth.md`: UCSD email verification as
  the first auth path.
- `0008-internal-user-id-for-app-db-ownership.md`: internal app user ID for App
  DB ownership.
- `0009-stage-real-backend-auth-validation-before-email-delivery.md`: validate
  the real backend auth path before production-like email delivery.
- `0010-reuse-worksheet-management-interface-with-saved-worksheet-model.md`:
  reuse the original worksheet management interface pattern while keeping UCSD
  Saved Worksheet data ownership separate from legacy worksheet-number APIs.
- `0011-introduce-snapshot-static-availability-data.md`: introduce enrolled,
  capacity, and waitlist as snapshot-static section fields, superseding ADR 0004.
- `0012-forward-accumulating-term-archive-bounded-by-source.md`: live schedule
  snapshots are bounded by the UCSD source's rolling term window; multi-term depth
  is built by forward accumulation of frozen snapshots in external storage, and
  pre-window history (e.g. 2021) is delivered only as Historical GPA.
- `0013-per-cell-partial-snapshot-with-import-manifest.md`: at all-subject /
  multi-term scale, snapshot generation tolerates per-cell failures and publishes
  an auditable Import Manifest, superseding the global fail-hard rule of ADR 0005.
- `0014-multi-term-display-semantics.md`: availability staleness is labeled by
  term state and there is no single course-level Average GPA summary, refining
  ADR 0011 and superseding the Average GPA card of ADR 0003.
- `0015-multi-term-saved-worksheets-and-cross-term-add-routing.md`: signed-in
  accounts get a term selector and cross-term catalog adds route silently into
  that term's Active Saved Worksheet (resolved active → Main → on-demand create)
  instead of being rejected, reaching parity with anonymous worksheets, extending
  ADR 0010 without changing the single-term Saved Worksheet model.
- `0016-stage-real-email-login-on-staging-before-production.md`: real email
  login rollout starts on staging, while production keeps the public login entry
  point hidden until staging proves deliverability, HTTPS cookies, Redis session
  restore, App DB ownership, and failure behavior.
- `0017-use-verification-codes-for-first-real-email-login.md`: the first hosted
  email-login rollout uses 6-digit verification codes instead of magic links, so
  staging can prove real delivery and App Backend behavior with the smallest
  change from the validated local flow.
- `0018-use-resend-for-first-real-email-delivery.md`: the first hosted
  verification-code email rollout uses Resend because it keeps staging setup
  small while preserving a provider-neutral App Backend boundary for future
  SES/Postmark migration if needed.
- `0019-use-dedicated-sending-subdomain-for-verification-email.md`: UCSD
  verification-code email uses a dedicated sending subdomain under the product
  domain, isolating DNS records, sender reputation, and future provider
  migration from the primary web domain.
- `0020-keep-email-domain-configurable-until-product-domain-is-final.md`: until
  SunGrid's final product domain is chosen, Resend sender domain/from-address
  values stay configurable and formal hosted real-email acceptance waits for a
  verified dedicated sending subdomain.
- `0021-fail-closed-when-hosted-email-config-is-missing.md`: hosted staging and
  production email login must fail closed when Resend/sender configuration is
  missing, while development and tests may use explicit fallback senders.
- `0022-use-versioned-drizzle-migrations-for-shared-databases.md`: shared
  staging and production App DB schema changes must use versioned Drizzle
  migrations, while direct schema push remains limited to disposable local
  validation databases.
- `0023-gate-public-production-login-entry-with-feature-flag.md`: production may
  deploy login backend support before public availability, but user-visible
  login entry points and public route behavior stay behind an environment flag
  until hosted acceptance passes.
- `0024-use-hasura-for-shadow-course-data-projection.md`: select Hasura for the
  separately owned Course Data Store shadow projection without changing the
  Published Snapshot frontend path.
- `0025-defer-hosted-shadow-course-data-platform.md`: keep the first hosted
  staging environment focused on the user-facing App path while Course Data
  Store and Hasura remain a locally validated shadow path.
- `0026-use-upstash-redis-for-first-worker-hosting.md`: preserve Redis session
  and verification-limit semantics through Upstash REST for the first Worker
  deployment instead of redesigning them around Durable Objects.
- `0027-use-neon-postgres-through-hyperdrive.md`: retain the App DB's PostgreSQL
  contract on Neon while Worker runtime queries use Hyperdrive and migrations
  remain a separate controlled deployment operation.
- `0028-use-one-origin-for-first-hosted-staging.md`: serve the frontend,
  Published Snapshot routes, and `/api/*` from one staging origin to reduce
  browser credential and CORS failure modes during hosted login acceptance.
- `0029-store-published-snapshots-in-r2.md`: keep accepted Published Snapshots
  and Import Manifests in private R2 as the hosted serving source now and the
  import, rollback, and parity record after a future GraphQL cutover.
- `0030-add-a-worker-composition-root.md`: keep the Node and Docker composition
  for local validation while a dedicated Worker root assembles hosted adapters
  around the same Core App Backend behavior and contract tests.
- `0031-use-fixed-thirty-day-hosted-sessions.md`: expire hosted login sessions
  thirty days after verification without rolling renewal, using a host-only
  secure cookie and the same fixed TTL in Upstash.
- `0032-use-forward-compatible-database-migrations.md`: use forward-only
  expand-and-contract schema changes so Worker rollback does not require an
  automatic destructive database down migration.
- `0033-isolate-hosted-environment-state.md`: give staging and production
  separate databases, sessions, object storage, email keys, secrets, backup
  credentials, and deployment identities; create only staging in the first
  hosted phase.
- `0034-confine-email-addresses-to-short-lived-delivery-audit.md`: keep full
  recipient addresses only in a seven-day maintainer-only App DB audit while
  general telemetry uses masked addresses and environment-specific HMAC refs.
- `0035-use-only-the-staging-product-origin.md`: expose hosted staging only at
  the product staging domain and disable public `workers.dev` and `r2.dev`
  paths that would bypass the single-origin security boundary.
- `0036-preserve-tss-coverage-and-seat-source-semantics.md`: use TSS request and
  coverage metadata to distinguish zero offerings from incomplete responses,
  and preserve source-provided available seats without inventing enrollment
  totals.
- `0037-use-explicit-tss-availability-supplement.md`: parse the mixed-format TSS
  availability supplement as an authoritative, audited enrichment for matched
  schedule components without creating sections that lack meeting data.
- `0038-model-tss-unbounded-capacity-and-reported-seats.md`: preserve
  source-reported available seats, model TSS sentinel limits as effectively
  unbounded, and reject explicit non-active supplement status values.
- `0039-separate-catalog-terms-from-worksheet-planning-window.md`: keep all
  Supported Terms browsable in the Catalog while limiting Worksheet navigation
  and Catalog add/remove actions to Summer Session I 2026 through Fall 2026,
  refining ADR 0015.
- `0040-use-public-class-planner-api-as-schedule-source.md`: acquire FA26+
  schedule data from the unauthenticated Class Planner API and convert it to
  the existing tss-chatbot-v1 contract, replacing login-gated TSS exports and
  demoting TritonGPT CSV capture to a fallback.
- `0041-one-command-etl-refresh-orchestrator.md`: encode the full data-refresh
  sequence (SoC window, then Class Planner terms, validators, DuckDB refresh
  report) behind `bun run etl:refresh`, with source conflicts as hard errors
  and commit/deploy/acceptance kept manual.
- `0042-scheduled-refresh-with-review-prs.md`: launchd runs the refresh in an
  isolated worktree twice a week and opens a review PR only on material
  change; merge, deploy dispatch, and Staging acceptance stay human.
- `0043-roll-out-merged-scheduled-refreshes-through-protected-environments.md`:
  after a scheduled refresh PR is merged and `main` CI succeeds, automatically
  enter the protected Staging then Production workflow while preserving both
  Environment approvals and keeping Production login disabled.

## Editing Rule

Do not silently rewrite old ADRs as if the original decision changed. If a
decision is superseded, create a new ADR or add a dated note that explains the
newer observed state and links to the detailed planning doc.
