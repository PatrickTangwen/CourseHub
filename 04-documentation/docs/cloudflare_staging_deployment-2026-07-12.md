# Cloudflare staging deployment workflow (2026-07-12)

> Current-status note (2026-07-14): later Staging run
> [29298271623](https://github.com/PatrickTangwen/coursetable-ucsd/actions/runs/29298271623)
> accepted commit `415cf4197cfdc0063bca62dcdda6a09d933a6ab1`. The first-run
> failure and recovery history below is preserved for audit. Current Production
> state and operator procedures are recorded in
> `cloudflare_production_operations-2026-07-14.md`.

Status: issue #117 is merged. The first protected run on 2026-07-12 reached the
Worker deployment stage but failed closed before acceptance; the outcome and
recovery change are recorded below. This document does not authorize production
changes.

## Trigger and trust boundary

`.github/workflows/cloudflare-staging-deploy.yml` exposes only
`workflow_dispatch`. The maintainer must select the `staging` target and a full
commit SHA. The optional `recover_unaccepted_first_deployment` input defaults to
`false` and requires a separate explicit human decision before the workflow may
remove a Worker stranded by a failed first deployment. Recovery also requires
the exact stranded Worker version from that failed run. A credential-free
preflight checks out that commit, fetches
`origin/main`, proves the selected commit is reachable from `main`, runs the
repository checks, the failure-safety and Worker Catalog validators, and the
disposable App DB migration compatibility proof. A failed preflight enters a
separate protected reporting job so the summary still identifies the durable
last accepted deployment without exposing R2 credentials to preflight.

The deployment job runs only when the workflow itself was dispatched from
`main`. It targets the protected GitHub `Staging` Environment, so its provider
and runtime secrets remain unavailable until the configured maintainer review
has completed. Pull-request jobs never receive these secrets.

## Ordered deployment

The protected job performs these stages in order:

1. Read the durable last-accepted record from private R2, capture the current
   100-percent-traffic Worker version, and refuse to mutate staging if those
   versions differ. Before the first accepted deployment, an already-existing
   Worker is likewise treated as unaccepted drift. Only the explicit recovery
   input may remove that Worker, and only while no accepted record exists and
   the captured and immediately re-read Worker versions both match the
   human-supplied stranded version.
2. Apply forward-only Drizzle migrations through the dedicated
   `NEON_MIGRATION_DATABASE_URL`. App DB backup continues to use the separate
   `NEON_DIRECT_DATABASE_URL`.
3. Merge the durable R2 Term Archive registry with every paired, validated
   repository Published Snapshot and Import Manifest. R2-only terms remain in
   the registry as Frozen Snapshots; already-frozen entries retain their exact
   object paths and generation timestamps and are never regenerated. Upload
   new content-addressed objects to private Standard R2, read every current and
   preserved object back, verify its SHA-256 digest, and switch `metadata.json`
   only after all objects pass.
4. Generate the staging-only Wrangler configuration from protected
   non-sensitive inputs, build the frontend, enforce the 20,000-static-asset
   Free limit, and perform a strict dry run.
5. Deploy the Worker, static assets, custom domain, bindings, and runtime
   secrets in one Wrangler deployment. `workers.dev` and preview URLs remain
   disabled; the only configured public ingress is
   `staging.sungridplanner.com`.
6. Repeat public Catalog and unauthenticated auth/Session/account-route smokes
   at least three times. The smoke fails on unexpected status, provider-default
   URLs, or Cloudflare CPU/resource-limit responses and never creates or
   bypasses a Verified UCSD Email identity. Before those checks, a bounded
   five-minute total readiness deadline retries transport-level connection
   failures from initial Custom Domain activation. Every request has its own
   shorter abort timeout, and the retry delays count toward the total deadline;
   HTTP application failures are never retried or hidden.
7. The provider-readback `Verify Workers Free boundary` gate was removed by
   explicit user decision on 2026-07-13. Live runs proved that its provider
   surfaces diverged from the documented account reality in sequence: Workers
   Free had no Workers subscription record (run 29221583280), its default usage
   model was `standard` (run 29222442338), and the modern script-list response
   omitted route inventory (run 29224156665). The plan's hard caps remain in
   force, and the Worker still receives the mirrored `WORKERS_FREE_*`
   application budget variables; these safeguards no longer depend on a
   provider-readback acceptance gate.
8. Persist a non-sensitive, digest-verified deployment record containing the
   Git commit, Worker version, frontend build identity, App DB schema version,
   active Published Snapshot and archive digests, timestamp, and smoke evidence.
   The accepted record becomes
   `deployment-evidence/last-accepted.json` in private Catalog R2.

## Safe failure and rollback

Checks and migration failures stop before public deployment. Content-addressed
R2 objects may remain after an interrupted publication, but they are not
current until the metadata pointer changes. A later failure restores the prior
metadata pointer and verifies it by digest.

If a durable prior accepted Worker version existed, failure after a deployment
attempt rolls traffic back to that exact version and verifies it is again
receiving 100 percent. It never treats arbitrary pre-run drift as accepted. If
the first Worker deployment fails, the workflow deletes that first Worker
through the least-privilege Workers Scripts API and verifies it is absent; it
does not invoke Wrangler's unrelated KV inventory path or require KV access. No
unaccepted Custom Domain or provider-default surface may remain. Term Archive
metadata and the deployment-evidence pointer are restored independently when
their updates were attempted. The new evidence object is written locally and
to its immutable timestamped key first; `last-accepted.json` is the final
digest-verified acceptance step. The final job summary reports the last
accepted deployment, or `none` before the first acceptance.

## Remaining human acceptance

Issue #85 owns real UCSD mailbox delivery, code verification, fixed Session
restore/logout, Saved Search and Saved Worksheet ownership, provider failure
drills, backup restore, and the forty-eight-hour observation window. The #117
automated smoke deliberately does not manufacture a verified account to claim
that evidence.

`APP_DB_BACKUP_ENABLED=false` remains required until migration, the first
accepted deployment, and the restore verification are all accepted. The #117
workflow asserts the protected repository variable is exactly `false` before
migration; it neither changes that variable nor creates or mutates production
resources.

The human-provisioning handoff did not originally record Billing Read or Account
Analytics Read. The maintainer later added both read-only permissions to the
existing deployment token without Billing Edit. After removal of the
provider-readback gate, neither extra permission is used by this workflow. This
change does not modify the token, its permissions, or any subscription.

## First hosted run outcome (2026-07-12)

The first protected run was
[GitHub Actions run 29217388935](https://github.com/PatrickTangwen/coursetable-ucsd/actions/runs/29217388935)
for merge commit `005e9b5b626f1c116e92d1341050af63d1b2c416`.
Credential-free preflight, migration, Term Archive publication, static build,
and Worker deployment passed. The immediate first smoke request encountered a
transport connection failure before the Custom Domain was reachable, so the
Free-boundary gate and accepted-evidence write did not run.

The attempted first-deployment rollback restored Catalog state but Wrangler's
delete command then queried an unrelated KV namespace endpoint that the
least-privilege deployment token correctly cannot access. The run therefore
left an unaccepted Worker and reported no accepted deployment. The follow-up
change adds the bounded transport-readiness probe, replaces Wrangler deletion
with the official Workers Scripts DELETE API, and adds the default-off explicit
recovery input plus exact-version match needed to remove only this unaccepted
first Worker before a retry. The deletion path re-reads the active version
immediately before DELETE and verifies the Worker is absent afterward. No
production resource or production-login setting was changed.

## Historical documentation boundaries

This dated implementation supersedes two operational statements but preserves
their source documents as historical records:

- `docs/worker_login.md` lines 41-45 describe hosted deployment migrations with
  `NEON_DIRECT_DATABASE_URL`. That statement is outdated for #117; the current
  deployment-only secret is `NEON_MIGRATION_DATABASE_URL`, while backup and
  recovery retain `NEON_DIRECT_DATABASE_URL`. The older document requires a
  separate review before any broader cleanup.
- `docs/hosted_failure_cost_safety-2026-07-12.md` lines 75-78 record a Workers
  Paid allowance of 10,000,000 monthly requests. That is historical #116
  context and is superseded for staging by issue #84's human-provisioned
  Workers Free boundary and this workflow's 100,000-request daily contract.
  The #116 document requires separate review rather than silent rewriting.

## Issue #85 acceptance scope update (2026-07-13)

The maintainer removed Saved Search from the product and issue #85 acceptance
scope. Hosted acceptance now covers Saved Worksheet ownership only. References
to Saved Search earlier in this dated record are preserved as historical #117
context and must not be interpreted as a current launch requirement.

The disposable Core App Backend validator also requires Express to trust the
private Docker gateway that supplies its forwarded HTTPS signal. Its Compose
network fixes the Linux gateway at `172.31.85.1`, and the example environment
trusts only that address plus Docker Desktop's `192.168.65.1` gateway. This
changes neither the staging nor production proxy trust boundary.

## Issue #85 provider acceptance follow-up (2026-07-13)

The Staging verification sender address moves from a repository Environment
variable and generated plaintext Worker variable to a protected Environment
secret installed as an encrypted Worker secret. The sender domain remains a
non-sensitive variable. This prevents GitHub Actions from repeating the full
sender address in every deployment step while preserving the runtime contract.

Frontend Sentry reporting now disables default PII, keeps only the App User ID
in user context, and scrubs events, transactions, and breadcrumbs before
transmission. Complete email addresses, request bodies and headers,
authentication material, connection strings, verification codes, and hashes
are removed at the browser boundary.

The first manually dispatched hosted backup run reached the protected Staging
job and cleaned up its disposable PostgreSQL container, but failed before a
backup could be accepted or restored. The command now reports only one fixed
failure stage (`initialize`, `create-dump`, or `publish-backup`) before its
existing generic error. Provider errors and connection details remain hidden.
This diagnostic does not weaken the requirement that only a successfully
uploaded, downloaded, restored, schema-checked, and cleaned-up run counts as
acceptance.
