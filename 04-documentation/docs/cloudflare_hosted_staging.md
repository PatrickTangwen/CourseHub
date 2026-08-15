# Cloudflare Hosted Staging

> Historical status note (2026-07-14): the boundary described here was later
> implemented and accepted in Staging, and the isolated Production deployment
> is now live. Use `cloudflare_staging_deployment-2026-07-12.md` for the dated
> Staging workflow record and
> `cloudflare_production_operations-2026-07-14.md` for current Production
> operations. The accepted design below remains the architectural history.

Status: accepted design and issue map. This document records hosted boundaries;
it is not yet an executable deployment runbook.

## Accepted first-stage boundary

- Cloudflare serves one public staging origin at
  `https://staging.sungridplanner.com`.
- React static assets and the Core App Backend share that origin; API routes
  remain under `/api/*`.
- A dedicated Worker composition root shares Core App Backend behavior and
  contract tests with the existing Node and Docker composition.
- Neon hosts the App DB PostgreSQL database; runtime queries use Hyperdrive.
- Upstash Redis REST preserves server-side session and verification-limit
  semantics.
- Private R2 stores accepted Published Snapshots and Import Manifests. The
  Worker serves them through the staging origin.
- Hosted Course Data Store and Hasura are deferred. They remain a locally
  validated shadow path until hosted shadow-query evidence is needed.
- Workers Paid is an accepted approximate USD 5 monthly baseline; Neon,
  Upstash, and R2 may begin within their free allowances.

## Session policy

Hosted sessions expire thirty days after email verification and do not roll
forward on ordinary requests. The cookie is host-only, `Secure`, `HttpOnly`,
`SameSite=Lax`, and scoped to `/`; the Upstash record uses the same fixed TTL.

## App DB backup policy

A scheduled backup operation will create a PostgreSQL custom-format logical
dump, calculate its SHA-256 digest, and upload the dump plus a non-sensitive
manifest to a private R2 backup bucket. It retains seven daily backups and four
weekly backups.

The manifest records the backup time, schema migration version, file size,
digest, environment identity, and backup-task version. It does not record
credentials, user emails, sessions, or SQL content.

A backup is not accepted merely because upload succeeded. The operator must
periodically restore a recent dump into a disposable PostgreSQL database, run
schema and key-table checks, and remove the disposable database after the
evidence is recorded.

## Initial deployment trigger

The first staging deployment uses a manually triggered GitHub Actions workflow
against a selected commit already present on `main`. The workflow automates
checks, migration-state validation and application, Published Snapshot upload
and verification, Worker and static-asset deployment, and non-sensitive health
smoke evidence. Real-email browser acceptance remains a deliberate human step.

Each deployment records the Git commit, Worker and frontend build identities,
App DB migration version, Published Snapshot term and digest, and deployment
timestamp. Automatic deployment on every `main` update is deferred until the
first hosted staging path is stable.

## Migration and rollback policy

App DB schema changes use forward-only expand-and-contract migrations. The
previous and next Worker versions must both remain compatible with the migrated
schema during the rollback window. Rolling back an application deployment
returns Worker and frontend code to a recorded version without automatically
running a database down migration.

Destructive contract migrations run only in a later deployment after backfill
and compatibility checks, a fresh logical backup, an explicit approval, and
confirmation that the old Worker version has left the rollback window.

## Environment isolation

Staging and production share code and workflow templates but never state or
credentials. Each environment has its own Worker deployment, domain, Neon App
DB, Upstash database, Hyperdrive binding, Published Snapshot and backup R2
buckets, Resend key, session secret, backup credential, and deployment record.

The first hosted phase creates staging resources only. Production remains
unconfigured and login-disabled rather than using staging resources as
temporary substitutes.

## Email delivery audit and telemetry privacy

The App DB may retain a maintainer-only Email Delivery Audit for seven days to
support per-recipient delivery investigation. It contains the normalized UCSD
email, request ID, provider message ID, request time, delivery outcome, and
expiration time. It contains no verification code or hash, cookie, session,
email body, or provider credential, and expired rows are deleted automatically.

Cloudflare logs, Sentry, GitHub Actions, and ordinary application logs never
contain a full email, verification code or hash, cookie, session ID, request
body, connection string, environment dump, or secret. They may contain a
masked address and an environment-specific HMAC reference alongside structured
request, outcome, latency, and deployment fields. Sentry applies an explicit
before-send scrub, and deployment scripts do not enable shell trace output.

## Cost guardrail

The initial operating target is no more than USD 10 per month. Usage alerts are
configured for Workers, R2, Neon, Upstash, and Resend, with maintainer attention
at 70 percent and urgent review at 90 percent of each relevant allowance or
budget. Provider billing alerts do not substitute for application controls.

At the safety budget, the system fails closed for new verification-email sends
and other abuse-prone writes while preserving the public Catalog and safe reads
of existing account data when their dependencies remain available. It never
falls back to a development verification code, deletes sessions or user data,
or accepts unbounded automatic plan upgrades.

## Production creation gate

Production resources are not created until staging passes all of the following:

- automated Worker contracts, fresh and repeated migration checks, R2 upload
  and digest checks, Catalog reads, non-UCSD rejection, fail-closed email
  configuration, telemetry-sensitive-field scanning, and absence of disabled
  legacy and Hasura routes;
- a real browser and UCSD mailbox flow covering delivery, code verification,
  session creation and refresh restore, Saved Search and Saved Worksheet
  ownership, logout, and rejection of the old cookie;
- explicit Resend, Upstash, and Neon failure behavior, Worker rollback against
  the forward-compatible schema, App DB dump restore into disposable Postgres,
  and R2 Snapshot digest recovery;
- at least forty-eight hours of observation without unexplained errors,
  sensitive-data leakage, abusive send volume, connection failures, cost
  alerts, or missing audit-expiration scheduling.

After the gate, production receives isolated resources and the same accepted
commit while its login feature flag remains disabled. Production-specific
smoke and explicit maintainer approval are still required before public login.

## Primary data region

The first staging App DB and session writes use one United States West primary
region, preferring AWS `us-west-2` when the selected Neon free project supports
it. Upstash uses the same primary region, Hyperdrive and Worker placement are
aligned with the Neon origin, and no multi-region session replica is enabled.

Static assets continue to use Cloudflare's edge network. Resend remains in its
already selected `us-east-1` region. The exact Neon region is verified at
resource creation rather than assumed from this proposed design.

## Initial resource provisioning

The first staging environment does not introduce Terraform. The maintainer
creates the Cloudflare Worker, Hyperdrive configuration, private R2 buckets and
custom route, Neon project, Upstash database, and Resend key once through their
provider controls, following a recorded checklist.

Non-sensitive Worker names, compatibility settings, route patterns, binding
names, bucket names, environment structure, and deployment behavior are stored
in repository configuration. GitHub Actions automates checks, migrations,
Snapshot upload, deployment, smoke, and evidence. Provider and deployment
credentials remain only in their scoped secret stores.

The eventual executable runbook records resource names, region, non-sensitive
IDs, owner account, creation date, secret-location names, rotation procedure,
and teardown order. Production provisioning revisits infrastructure as code
after the staging shape is proven.

## Issue and ownership plan

Implementation is tracked by PRD #109 and independently verifiable agent
slices:

- #110 prepares the runtime-neutral Core App Backend composition;
- #111 serves the Catalog from one Worker origin and private R2;
- #112 completes hosted login through Neon, Hyperdrive, and Upstash;
- #113 restores Saved Search and Saved Worksheet ownership on Worker;
- #114 adds Email Delivery Audit and hosted telemetry privacy;
- #115 proves forward migrations and recoverable App DB backups;
- #116 enforces hosted failure and cost safety boundaries;
- #117 deploys Cloudflare staging through an auditable workflow.

Existing issues may be updated after the new dependency graph is approved:

- issue #84 is human-owned staging provider, DNS, binding, and secret
  configuration;
- issue #85 is human-owned real-email staging acceptance and observation;
- issue #86 is human-owned production resource creation, enablement, and
  rollback approval.

No implementation work or external resource creation begins merely because
this proposed design document exists.

## Public ingress boundary

All hosted staging traffic enters through `staging.sungridplanner.com`. The
default `workers.dev` endpoint is disabled as a public route, R2 buckets remain
private with no `r2.dev` access, and database or session-provider endpoints are
never browser configuration. This keeps WAF, cache, cookie, and acceptance
evidence on one product-controlled origin.

## Deferred GraphQL cutover

Published Snapshot remains the frontend course-data contract for the first
hosted stage. If the frontend later adopts the bounded GraphQL path, accepted
Snapshots and Import Manifests remain in R2 as the Course Data Store import
source, rollback baseline, and parity-audit record. That cutover requires a
separate decision that supersedes the current snapshot-first contract.
