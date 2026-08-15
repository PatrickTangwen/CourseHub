# Cloudflare Production code readiness (2026-07-13)

> Historical status note (2026-07-14): this document records the pre-launch
> code and provisioning contract. Production has since been provisioned,
> deployed, rollback-tested, backup/restore-tested, and opened for public login;
> issue #86 is closed. Use
> `cloudflare_production_operations-2026-07-14.md` for the current state and
> operator workflow. The original readiness record below is preserved for
> audit.

Status: code-only implementation for issue #86. This document does not
authorize or record a Production resource, GitHub Environment, DNS record,
billing change, secret, deployment, backup schedule, or public-login change.

## Scope reconciliation

Issue #85 is closed by maintainer decision. Its remaining forty-eight-hour
observation period, second verified UCSD account, and real Neon/R2 failure
injection were removed from accepted scope and are not claimed as completed.
Saved Search is not a product or Production acceptance requirement. Saved
Worksheet remains the account-owned planning feature.

## First-deployment boundary

`.github/workflows/cloudflare-production-deploy.yml` is a manual-only workflow.
It accepts a full commit already reachable from `main`, runs credential-free
preflight checks, and then requires that exact SHA to equal the protected
`STAGING_ACCEPTED_COMMIT` variable before any external state is captured or
changed. Every external step is behind the protected GitHub `Production`
Environment. The workflow has its own concurrency group and durable deployment
identity; it does not use the Staging Environment or Staging concurrency group.

The workflow has no login-enable input. Its first-deployment contract forces
both of these values to `false`:

- frontend build input `VITE_PUBLIC_LOGIN_ENABLED`;
- Worker runtime variable `PUBLIC_LOGIN_ENABLED`.

When the runtime gate is not the exact string `true`, new verification requests
and code-verification requests return a generic `404`. Public Catalog,
Anonymous Worksheet, current-Session inspection, logout, and authenticated
account data remain separate from that new-login gate. The hosted Production
smoke proves the Catalog, unauthenticated Session, Saved Worksheet boundary,
and disabled verification entry without creating a user or sending email.

Public enablement is intentionally impossible in the first-deployment workflow.
The separate manual
`.github/workflows/cloudflare-production-login-toggle.yml` path can deploy only
the durable Staging-accepted commit and shares the Production deployment
concurrency lock. It requires the protected `Production` Environment plus a
fresh public issue approval identifier in the form `issue-86-comment-NNN`. It
verifies that the referenced comment has GitHub `OWNER` association and contains
the exact line `APPROVE PRODUCTION LOGIN ENABLED` or
`APPROVE PRODUCTION LOGIN DISABLED` for the requested action. The comment must
belong to issue #86 and be newer than the current accepted Production evidence;
the accepted pointer records its ID and timestamp, so an old approval cannot be
replayed. It
changes only the Worker/frontend login flag, verifies the accepted Worker has
not drifted, runs a login-state smoke, records a privacy-safe accepted pointer,
and restores the prior accepted Worker on failure. Its default action is
`disabled`, providing the immediate feature-flag rollback path without deleting
backend support or user data.

The presence of this dormant path is not launch authorization. Selecting
`enabled` still requires a new explicit maintainer approval after
Production-specific migration, Catalog, privacy, backup/restore, cost-control,
smoke, and rollback evidence is accepted. The automated enabled-state smoke
uses an invalid non-deliverable address only; the separately authorized
redacted real-email acceptance remains a human launch step.

## Non-sensitive Production Environment variables

The human-created protected GitHub `Production` Environment supplies these
values. They must describe Production-only resources and must not copy Staging
resource identities.

- `APP_DB_BACKUP_ENABLED` — keep exactly `false` through first deployment and
  backup/restore readiness review;
- `CLOUDFLARE_ACCOUNT_ID`;
- `CLOUDFLARE_PRODUCTION_HOSTNAME` — exact public hostname chosen by the
  maintainer;
- `CLOUDFLARE_WORKER_NAME`;
- `HYPERDRIVE_CONFIG_ID` — Production Hyperdrive with query caching disabled;
- `PRODUCTION_ISOLATION_VERIFIED_AT` — UTC timestamp for the completed human
  isolation checklist;
- `R2_BACKUP_BUCKET`;
- `R2_BACKUP_PRIVATE_ACCESS_VERIFIED_AT`;
- `R2_CATALOG_BUCKET`;
- `STAGING_ACCEPTED_COMMIT` — full durable SHA from the accepted Staging
  evidence; the first deployment and every later login toggle must match it;
- `VERIFICATION_EMAIL_SENDER_DOMAIN`.

The repository contract rejects the known Staging hostname, Worker name, and
Catalog bucket. Provider configuration must additionally prove that Hyperdrive,
Neon, Upstash, Resend, R2 credentials, routes, and deployment tokens are not
shared; their values are not available to repository tests.

## Production Environment secrets

Store values only in the protected GitHub Environment or their owning provider.
Do not paste them into chat, issues, logs, or this document.

- `CLOUDFLARE_API_TOKEN`;
- `NEON_DIRECT_DATABASE_URL`;
- `NEON_MIGRATION_DATABASE_URL`;
- `R2_BACKUP_ACCESS_KEY_ID`;
- `R2_BACKUP_SECRET_ACCESS_KEY`;
- `R2_CATALOG_ACCESS_KEY_ID`;
- `R2_CATALOG_SECRET_ACCESS_KEY`;
- `RESEND_API_KEY`;
- `SESSION_SECRET`;
- `TELEMETRY_HMAC_KEY`;
- `UPSTASH_REDIS_REST_TOKEN`;
- `UPSTASH_REDIS_REST_URL`;
- `VERIFICATION_EMAIL_FROM_ADDRESS`.

## Human-owned provisioning and approval sequence

1. Approve Production spend limits and create isolated provider resources.
2. Configure the Production hostname, DNS, private R2 boundaries, disabled
   provider-default routes, cost alerts, and cache-disabled Hyperdrive.
3. Create the protected GitHub `Production` Environment with required reviewer
   protection and the variables/secrets above. Keep backup automation disabled.
4. Review the selected Staging-accepted commit and explicitly authorize a
   login-disabled first deployment.
5. Dispatch the Production workflow from `main`; review migration, publication,
   smoke, and privacy-safe evidence. Before acceptance, dispatch once with
   `prove_rollback_after_smoke=true`: the run is expected to fail deliberately
   after its successful smoke and must show verified restoration/removal in the
   protected run log. Then dispatch with the option `false` to accept the same
   commit.
6. Dispatch `.github/workflows/app-db-backup-production.yml` manually, accept
   its real backup/restore proof, then decide whether to enable its schedule.
7. Only after all evidence is accepted, post a fresh approval record and review
   the protected login-toggle workflow. Dispatch `enabled`, complete the
   redacted real-email acceptance, and retain `disabled` as the immediate
   rollback action.

The agent does not perform steps 1-3, 5-7 merely because these repository files
exist.

## Backup and rollback

`.github/workflows/app-db-backup-production.yml` uses the existing
environment-aware backup implementation with the exact
`production/app-db/` namespace, a Production-only backup bucket and credential,
and a disposable PostgreSQL restore. Its schedule is inert unless the protected
Production variable `APP_DB_BACKUP_ENABLED` is exactly `true`.

The deployment workflow keeps the accepted deployment pointer inside the
isolated Production Catalog bucket. It rejects pre-deploy Worker drift, restores
the prior accepted Worker and Catalog metadata after a failed deployment, and
does not run a destructive database down migration.

The manual `prove_rollback_after_smoke` input provides a deliberate rollback
proof without accepting the candidate: after the candidate passes the hosted
smoke, the workflow intentionally enters its failure path. The restore command
read-backs the prior Worker/Catalog state, or removes the unaccepted Worker and
Catalog pointer during the first-deployment case. The resulting run is expected
to be red; its restoration output is the evidence to review before the later
accepting dispatch. This workflow definition does not perform that proof by
itself, and the launch remains no-go until a protected Production run records it.

## Local validation

```sh
bun run validate:staging-deployment
bun run validate:production-deployment
bun run test:snapshot
bun run test:worker
bun run typecheck
bun run checks
```

The Production validator uses non-routable example identities. Passing it means
the repository contract is internally consistent; it does not prove that any
Production provider resource exists.
