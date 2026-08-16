# App DB backup and recovery proof (2026-07-11)

Status: local implementation and contract acceptance for issue #115. No hosted
database, R2 bucket, secret, Cron Trigger, GitHub variable, or production
configuration was created or modified by this change.

## Execution boundary

The App DB backup task runs on a controlled GitHub Actions runner rather than in
the App Worker. A PostgreSQL custom-format logical dump requires the native
`pg_dump` program, which is not available in the Worker runtime. The Worker's
existing `0 8 * * *` Cron Trigger remains dedicated to Email Delivery Audit
cleanup.

`.github/workflows/app-db-backup.yml` declares a daily staging trigger at
`08:17 UTC` and also supports manual dispatch. Scheduled work is inert unless
the repository variable `APP_DB_BACKUP_ENABLED` is exactly `true`. Human
provisioning issue #84 owns that enablement and the corresponding staging-only
resources and secrets.

The workflow uses PostgreSQL 18 client tools from the official container image.
It reads the staging App DB through the direct Neon connection contract; it
does not run dumps or migrations through Hyperdrive.

## Private backup store

Backups use the separate `R2_BACKUP_BUCKET`, never `CATALOG_BUCKET`. The R2 S3
adapter receives `CLOUDFLARE_ACCOUNT_ID`, `R2_BACKUP_ACCESS_KEY_ID`, and
`R2_BACKUP_SECRET_ACCESS_KEY` only from the protected Staging environment. The
bucket remains private and no `r2.dev` URL is used.

The hosted command refuses to start if `R2_BACKUP_BUCKET` equals the configured
Catalog bucket. It also requires the protected Staging variable
`R2_BACKUP_PRIVATE_ACCESS_VERIFIED_AT` to contain the UTC timestamp at which the
human provisioning checklist confirmed that `r2.dev` and custom-domain public
access were disabled. Issue #84 supplies that evidence; this implementation
does not create it.

Every accepted staging bundle has two objects under the exact
`staging/app-db/` namespace:

- a PostgreSQL custom-format `.dump` object;
- an adjacent `.manifest.json` acceptance object.

The dump is uploaded first with backup time, environment, schema version,
SHA-256, byte size, and backup-task version metadata. The adapter reads the
stored object back with `HeadObject`; the manifest is written only when size
and every metadata field match. Backup evidence encodes the same SHA-256 as a
non-sensitive base64url content digest and never prints the dump, row data, a
database URL, or a credential.

The task reads the migration version before and after `pg_dump` and rejects the
artifact if the version changed, preventing a concurrently migrated schema from
receiving stale backup metadata.

## Retention

Retention is evaluated in UTC and keeps the newest accepted backup in each of
seven distinct calendar days plus the newest accepted backup in each of four
distinct Monday-based weeks. Daily and weekly selections are combined, so one
object may satisfy both slots.

Deletion accepts only complete dump/manifest bundles whose dump key is directly
inside the configured environment namespace. A key containing another path,
`..`, or another environment is rejected before an R2 delete request is made.

## Restore verification

Each accepted workflow backup is downloaded again and checked against its
manifest before restore. The workflow starts a disposable PostgreSQL 18
database, runs `pg_restore` with exit-on-error and without ownership or
privilege restoration, then verifies:

- the Drizzle schema version equals the backup manifest;
- `appUsers`, `emailVerificationCodes`, `emailDeliveryAudits`, `savedSearches`,
  `savedWorksheets`, and `savedWorksheetSections` all exist and are readable.

The disposable database and Docker network are removed in an `always()` step.
Restore evidence contains only object identity, content digest, size, schema
version, task version, environment, and the checked table names.

## Migration and rollback proof

Both `db:migrate` and `db:migrate:hosted` now report exactly one non-sensitive
JSON field after success:

```json
{ "schemaVersion": "0002_wild_skaar" }
```

The version is derived by matching the database's latest Drizzle journal entry
to the committed local journal. A fresh disposable PostgreSQL database applies
all migrations, and an immediate repeated command reports the same version
without applying another migration. Migration failures replace driver details
with a bounded error so database URLs and credentials are not printed.

The expanded schema is exercised through the same external Worker login and
account-owned planning contract twice. The first run uses the current Worker;
the second creates a temporary detached worktree at pre-#114 revision
`51d655dc6b0915a6f9bed7dfa1e76db0f9dc97a2` and runs that revision's actual
Worker and database adapters against the already expanded database. Neither
application rollback nor backup/restore asset contains a down-migration,
`dropdb`, `pg_restore --clean`, or equivalent destructive schema rollback.

## Local validation

The complete provider-independent proof uses disposable PostgreSQL and a local
filesystem object-store adapter:

```sh
api/drizzle/test-migrate.sh
api/drizzle/test-backup-recovery.sh
```

The first command proves fresh migration, idempotent rerun, schema-version
reporting, and previous/next Worker compatibility. The second creates a real
custom-format dump containing a private test row, publishes and downloads it,
restores it into another disposable database, runs the schema/key-table checks,
and removes both databases and all temporary backup objects.

Current provider references used for this implementation:

- [Neon `pg_dump` and `pg_restore`](https://neon.com/docs/manage/backup-pg-dump)
- [PostgreSQL custom-format dumps](https://www.postgresql.org/docs/current/backup-dump.html)
- [PostgreSQL `pg_restore`](https://www.postgresql.org/docs/current/app-pgrestore.html)
- [Cloudflare R2 S3 API](https://developers.cloudflare.com/r2/api/s3/api/)

## Hosted acceptance follow-up (2026-07-13)

Issue #85 run `29276398861` reached the hosted backup command but failed safely
in the original coarse `create-dump` stage. Restore was skipped, the disposable
PostgreSQL container and network were removed, and no provider detail was
printed. The follow-up workflow now prepares the dedicated backup role with
current and default read-only grants for both the application `public` schema
and the Drizzle migration schema before running the backup. Failure evidence
also distinguishes the schema read before the dump, the custom-format dump,
and the schema read after the dump without retaining connection or tool error
text.

## Production acceptance and schedule state (2026-07-14)

Production uses a separate Neon project, Hyperdrive configuration, migration
role, runtime role, backup role, private R2 backup bucket, and bucket-scoped
backup credential. It does not reuse the Staging App DB or backup objects.

The manual Production workflow run
[29303511779](https://github.com/PatrickTangwen/coursetable-ucsd/actions/runs/29303511779)
created a real Production logical dump, uploaded and retained it in the private
Production backup bucket, restored it into disposable PostgreSQL, verified the
accepted schema and key tables, and removed the disposable resources. This
proves backup/restore readiness; it does not replace the live Production
database or authorize an in-place restore.

`.github/workflows/app-db-backup-production.yml` declares a daily `08:47 UTC`
schedule. Manual dispatch runs independently of the schedule flag. Scheduled
events run the backup job only when the protected Production variable
`APP_DB_BACKUP_ENABLED` is exactly `true`; it remains `false` as of this update.

Do not enable the variable in isolation. The current
`.github/workflows/cloudflare-production-deploy.yml` still requires
`APP_DB_BACKUP_ENABLED=false` as a first-deployment safety guard, so flipping
the variable now would block subsequent Production deployments. Revise and
accept that deployment guard, assign failure-notification ownership, then
enable the schedule and observe the first scheduled backup as a separate
operations change.

See `cloudflare_production_operations-2026-07-14.md` for the current Production
workflow map, rollback boundary, accepted run evidence, and remaining
operations work.
