# Cloudflare Production operations (2026-07-14)

Status: current SunGrid Production state and operator map after issue #86 was
accepted and closed. This document supersedes the launch-status assumptions in
`cloudflare_production_readiness-2026-07-13.md`; that earlier document remains
the historical pre-provisioning and pre-launch contract.

## Current accepted state

- Public origin: `https://sungridplanner.com`.
- Accepted commit: `415cf4197cfdc0063bca62dcdda6a09d933a6ab1`, reachable
  from `main`.
- Issue [#86](https://github.com/PatrickTangwen/coursetable-ucsd/issues/86)
  is closed as completed.
- Public UCSD email login is enabled through the separately approved login
  toggle workflow.
- Public Catalog and anonymous Worksheet remain usable without an account.
- Production App DB migrations, Catalog publication, real-email verification,
  Session restore, Saved Worksheet ownership, logout, application rollback, and
  App DB backup/disposable restore have all been accepted.
- `APP_DB_BACKUP_ENABLED` remains `false`; scheduled Production backups are not
  currently running.
- The maintainer explicitly waived the remaining forty-eight-hour observation
  gate. Continued post-launch observation is recommended but is not an open
  launch blocker.

## Isolated Production boundary

Production does not borrow Staging state. It uses separately provisioned
resources and protected `Production` Environment values:

- a Production-only Cloudflare Worker and custom-domain route;
- private Production Catalog and App DB backup R2 buckets with separate
  bucket-scoped credentials;
- a Production-only Hyperdrive configuration with caching disabled and TLS
  required;
- a separate Neon project, `sungrid-production`, with database `sungrid` and
  distinct runtime, migration, and backup roles;
- a separate Upstash Redis database for hosted Sessions and verification
  limits;
- a Production-specific Resend key and verified sender domain;
- separate Session, telemetry, deployment, and backup credentials.

Runtime App DB requests use the `APP_DB_HYPERDRIVE_NO_CACHE` binding. Migrations
and logical backups connect directly to Neon through separate protected GitHub
Environment secrets. Hyperdrive is the runtime connection layer, not the
database itself.

## Accepted Production evidence

| Gate                                 | Evidence                                                                                                           | Accepted result                                                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Staging-accepted commit              | [Staging run 29298271623](https://github.com/PatrickTangwen/coursetable-ucsd/actions/runs/29298271623)             | `success` at the Production commit                                                                                                 |
| Login-disabled Production deployment | [Production run 29298806734](https://github.com/PatrickTangwen/coursetable-ucsd/actions/runs/29298806734)          | `success`; migration, Catalog publication, Worker deployment, disabled-login smoke, and accepted evidence completed                |
| Deliberate public-login enable       | [Toggle run 29299283486](https://github.com/PatrickTangwen/coursetable-ucsd/actions/runs/29299283486)              | `success`; fresh maintainer approval was verified before deployment                                                                |
| Real App DB backup and restore       | [Backup run 29303511779](https://github.com/PatrickTangwen/coursetable-ucsd/actions/runs/29303511779)              | `success`; private Production backup was restored and checked in disposable PostgreSQL                                             |
| Application rollback drill           | [Rollback run 29303575008](https://github.com/PatrickTangwen/coursetable-ucsd/actions/runs/29303575008)            | Expected overall `failure`; hosted smoke passed, failure was deliberately injected, and the last accepted deployment was restored  |
| Real-email and account flow          | [Issue #86 final acceptance](https://github.com/PatrickTangwen/coursetable-ucsd/issues/86#issuecomment-4965192626) | Email delivery and verification, Session reload, Saved Worksheet persistence/cleanup, and logout passed without sensitive evidence |

The red rollback-drill conclusion is not an unresolved outage. The workflow is
designed to fail after a successful smoke so that its automatic restoration
path is exercised and auditable.

## Production workflow map

### Login-disabled deployment

Workflow:
[`cloudflare-production-deploy.yml`](../.github/workflows/cloudflare-production-deploy.yml)

This is a manual workflow. It accepts only a full commit reachable from `main`,
requires it to equal the protected `STAGING_ACCEPTED_COMMIT`, runs repository
and hosted-boundary checks, applies forward-only App DB migrations, publishes
the private Catalog, builds with login disabled, deploys, smokes, and records
the accepted Worker. A failed protected deployment restores the prior accepted
Worker and Catalog evidence.

This workflow is not the path for enabling public login. It always builds and
deploys the disabled state.

Current constraint: the deployment job explicitly requires
`APP_DB_BACKUP_ENABLED=false`. Turning scheduled backup on before that
first-deployment guard is revised will make later Production deploys fail at
the guard step.

### Public-login toggle

Workflow:
[`cloudflare-production-login-toggle.yml`](../.github/workflows/cloudflare-production-login-toggle.yml)

This manual workflow changes only the approved public-login state on the
durable accepted commit. `disabled` is the default and immediate feature-flag
rollback path. Each dispatch requires a fresh `OWNER` comment on issue #86 with
the exact approval line and an `issue-86-comment-NNN` identifier newer than the
last accepted Production evidence.

Issue #86 is closed but not locked, so the current workflow contract can still
read a new approval comment. The hard-coded issue dependency should be revised
before the project adopts a different incident or release-approval record.

### App DB backup and disposable restore

Workflow:
[`app-db-backup-production.yml`](../.github/workflows/app-db-backup-production.yml)

Manual dispatch always runs. The declared schedule is `08:47 UTC` daily, but a
scheduled event runs the job only when the protected Production variable
`APP_DB_BACKUP_ENABLED` is exactly `true`.

Each accepted run:

1. prepares the least-privilege Neon backup role;
2. creates a PostgreSQL 18 custom-format logical dump;
3. publishes the dump and manifest under `production/app-db/` in the private
   Production backup bucket;
4. applies the seven-daily plus four-weekly retention policy;
5. downloads the accepted artifact, restores it into disposable PostgreSQL,
   verifies the schema and key tables, and removes the disposable resources.

The workflow proves that a backup artifact is recoverable. It does not perform
an in-place restore over the live Production database. A destructive Production
recovery requires a separate incident decision, target database, and reviewed
restore procedure.

## Standard release sequence

1. Land the candidate on `main` and accept the exact commit through the Staging
   workflow and hosted smoke.
2. Update the protected `STAGING_ACCEPTED_COMMIT` only after reviewing Staging
   evidence.
3. Dispatch the login-disabled Production deployment for that exact commit and
   review migration, Catalog, Worker, smoke, privacy, and accepted-deployment
   evidence.
4. Post a fresh maintainer approval record and use the login-toggle workflow
   only when the intended public state should change.
5. Run a privacy-safe public smoke. Never post a complete email, verification
   code, Cookie, connection string, private mailbox screenshot, raw database
   row, or raw sensitive log.

## Rollback and recovery boundaries

- To hide new public login immediately, dispatch the login-toggle workflow with
  `desired_state=disabled` and a fresh exact maintainer approval comment.
- A failed deployment or login toggle automatically attempts to restore the
  last accepted Worker and Catalog evidence.
- Production database schema changes are forward-only. Application rollback
  must remain compatible with the expanded schema; workflows do not run a down
  migration.
- The deliberate rollback input is an acceptance drill, not a routine release
  mechanism. Its overall run is expected to be red after the successful smoke.
- Backup restore verification is disposable. Do not point its restore URL at
  the live Production App DB.

## Open operations work

The launch is accepted, but these non-blocking operations items remain:

1. Decouple the Production deployment workflow from the permanent
   `APP_DB_BACKUP_ENABLED=false` first-deployment guard before enabling the
   daily backup schedule.
2. Assign backup-failure notification ownership. GitHub Actions records failed
   runs, but the repository does not currently define a dedicated external
   paging or messaging channel for Production backup failures.
3. After items 1 and 2 are accepted, set `APP_DB_BACKUP_ENABLED=true`, observe
   the first scheduled run, and confirm retention without exposing object names
   or database contents.
4. Continue post-launch review of login failures, Resend delivery, Worker
   errors, Neon/Hyperdrive availability, Upstash usage, R2 usage, and provider
   cost alerts. This is operational observation, not a reinstatement of the
   waived launch gate.

Any provider credential rotation, live database restore, plan change, cost-cap
change, DNS mutation, or Production login-state change remains a separate
maintainer-authorized action.

## Dependency rollout acceptance (2026-07-17)

Production now accepts commit
`7b9ebd335d03ffbb868da7838dca1b1a733e63ca`, the merge commit from
[PR #158](https://github.com/PatrickTangwen/coursetable-ucsd/pull/158). That PR
made the R2 publication deadline cover the complete operation, added
privacy-safe Term Archive progress stages, and made Staging, Production, and
public-login workflows restore the last accepted deployment after cancellation
as well as failure.

The accepted hosted evidence is:

- [Staging run 29599601435](https://github.com/PatrickTangwen/coursetable-ucsd/actions/runs/29599601435)
  succeeded at the exact commit, including migration, Catalog publication,
  Worker deployment, hosted smoke, and accepted-deployment evidence.
- [Production run 29600031113](https://github.com/PatrickTangwen/coursetable-ucsd/actions/runs/29600031113)
  succeeded with public login disabled, including migration, Catalog
  publication, Worker deployment, hosted smoke, and accepted-deployment
  evidence.
- [Issue #86 comment 5005890849](https://github.com/PatrickTangwen/coursetable-ucsd/issues/86#issuecomment-5005890849)
  supplied the fresh post-acceptance owner approval for public login.
- [Login-toggle run 29601111143](https://github.com/PatrickTangwen/coursetable-ucsd/actions/runs/29601111143)
  verified that approval and the accepted Worker/commit, enabled public login,
  passed the hosted login-state smoke, and recorded the accepted toggle.

The maintainer then completed a privacy-safe real-email acceptance. The
verification email arrived, the code was accepted, the authenticated page
remained authenticated after one reload, logout succeeded, and the session was
no longer authenticated after logout. Delivery latency was not separately
recorded. No email address, verification code, Cookie, or other personal data
was retained.

The earlier [Production run 29596445649](https://github.com/PatrickTangwen/coursetable-ucsd/actions/runs/29596445649)
was cancelled while publishing the Term Archive, before a new Worker was
deployed or hosted smoke and acceptance ran. Its then-current failure-only
restore condition did not run on cancellation; verification showed that the
previous accepted Worker remained active and the Catalog content was unchanged.
No rollback or restore path ran during the later accepted Staging, Production,
or login-toggle workflows.

`APP_DB_BACKUP_ENABLED` remained `false` throughout this rollout. Scheduled
Production App DB backups are still disabled, and enabling them remains outside
this dependency release.

## FA26 Term Archive publication precondition (2026-07-21)

FA26 is a TSS-backed release candidate rather than a legacy Schedule of Classes
import. Before any hosted Term Archive publication, its repository Published
Snapshot must have a matching, non-empty Import Manifest generated by the
formal TSS publisher, and the FA26 metadata entry must point to that manifest.
The archive validator intentionally rejects unequal snapshot/manifest term
sets; skipping that validator or fabricating an empty manifest is not an
accepted recovery path.

The Import Manifest preserves incomplete source evidence. A structurally valid
manifest may still contain `partial` and `failed` cells, and the Published
Snapshot may still advertise `coverage.complete: false`. Therefore successful
credential-free Staging and Production deployment-contract validation proves
only that the paired archive can be published safely. It does not certify FA26
data completeness or authorize a hosted deployment.

Use the current procedure and status definitions in `docs/snapshot_pipe.md`.
Any future hosted rollout still requires an exact-commit dispatch and the
existing protected-environment approval; this documentation update performs no
provider mutation and grants no deployment authorization.

Current local acceptance status at commit `1a775ad`:

- Both credential-free Staging and Production deployment-contract validators
  pass with 15 paired archive terms.
- `tools/catalog-snapshot/tssPublishedSnapshotPipeline.test.ts` is red after
  the metadata-consolidation change: the cross-listed grade fixture expects
  `CAT:2` to retain the selected `DOG:5` grade row, but the published test
  snapshot has no grade row for that course.

This is not the earlier missing-manifest failure, but it means the exact commit
is not fully accepted for a hosted rollout. Resolve the regression and rerun
the complete credential-free acceptance set before requesting deployment.

### 2026-07-21 cross-listed grade follow-up

Commit `53a5c09` resolves the `CAT:2` fixture regression with the conservative
cross-listed Grade Archive rule documented in `grade_archive.md` and
`snapshot_pipe.md`. Snapshot, frontend, API, Worker, Term Archive, and local
single-origin Worker Catalog checks pass. The FA26 artifact adds inherited rows
only for `ANSC:129` and `ETHN:133`; coscheduled-only relationships remain
unavailable.

This supersedes the red-test status above for later local work. It does not
change the recorded state of commit `1a775ad`, certify FA26 source completeness,
authorize a hosted deployment, or grant provider-mutation permission.

## Bounded R2 publication retries (2026-07-23)

[Production run 30047986664](https://github.com/PatrickTangwen/coursetable-ucsd/actions/runs/30047986664)
published and verified every repository term object, then timed out while
reading an existing FA24 details object during the parallel Term Archive
registry verification. The 20-second request deadline failed the complete
deployment immediately; no new Worker was built or deployed. Automatic recovery
restored the accepted Catalog metadata, confirmed that a Worker rollback was
not required, and retained accepted Production commit `868e4ac`.

This was the second same-phase transient R2 timeout on 2026-07-23. The earlier
failure stopped on a different object, and an unchanged-commit retry succeeded,
so the evidence does not identify a corrupt object, credential failure, or
candidate-code regression. It identifies two weaknesses in the deployment
client: registry verification issued one term-level chain per archive term at
once, and the client did not retry its own outer deadline after aborting an AWS
SDK operation.

Later deployment code bounds registry verification to four concurrent
term-level chains. Complete S3-compatible R2 operations retain a 20-second
per-attempt deadline and retry only that explicit timeout, at most three total
attempts, with exponential backoff and jitter. Digest mismatches, authorization
failures, not-found results, and other provider failures are not converted into
retryable success. Publication still switches `metadata.json` only after every
current and Frozen Snapshot object passes full-body SHA-256 verification.
