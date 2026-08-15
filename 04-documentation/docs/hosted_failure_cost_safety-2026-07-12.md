# Hosted failure and cost safety boundaries (2026-07-12)

Status: local implementation and contract acceptance for issue #116. No hosted
provider resource, secret, schedule, billing setting, or production
configuration was created or modified by this change. Provider-side usage
alerts remain human-owned work in issue #84; the auditable deployment workflow
remains issue #117.

## Provider failure boundary

Every hosted dependency failure produces an explicit bounded JSON response
with `cache-control: no-store` and no false success, development code,
provider secret, or provider-default URL:

| Failure                       | External behavior                                                                                                                      |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Resend rejection (definitive) | `503 VERIFICATION_DELIVERY_FAILED`; the cooldown reservation is released so a later retry can send.                                    |
| Resend ambiguous delivery     | `503 VERIFICATION_DELIVERY_UNCERTAIN`; the reserved code stays consumable and no replacement is sent while the reservation is pending. |
| Upstash unavailable (limiter) | `503 VERIFICATION_REQUEST_UNAVAILABLE` on verification routes.                                                                         |
| Upstash unavailable (Session) | `503 AUTH_UNAVAILABLE` / `503 ACCOUNT_DATA_UNAVAILABLE` on account routes.                                                             |
| Neon/Hyperdrive unavailable   | `503 AUTH_UNAVAILABLE` / `503 ACCOUNT_DATA_UNAVAILABLE` on account routes.                                                             |
| R2 read failure               | `503 CATALOG_UNAVAILABLE` on Catalog API routes; static assets and account routes continue.                                            |
| R2 publication failure        | `publishAcceptedCatalog` throws and the `metadata.json` pointer is never switched, so the current Published Snapshot is unchanged.     |

The public Catalog and static assets never depend on Neon, Upstash, or
Resend; account routes never take down the Catalog path. Legacy, Ferry,
Hasura, direct-database, and audit routes stay `404` during every failure
state, and no `r2.dev` or `workers.dev` URL appears in any response.

## Verification and guessing budgets

The Worker runtime continues to enforce the existing abuse budgets from
`worker/wrangler.jsonc` (per-source request, global send, per-source and
per-email guessing, and the per-email cooldown) through the same Redis Lua
scripts as the Node composition. Composition-level tests in
`worker/src/appWorker.test.ts` exercise real exhaustion semantics through the
Worker fetch handler.

## Application Safety Budget

The Application Safety Budget is the application-enforced cap at which
abuse-prone writes fail closed while the public Catalog and safe reads of
existing account data continue. It is separate from provider billing alerts
and from the short-window abuse budgets above.

- `APPLICATION_SAFETY_SEND_LIMIT` / `APPLICATION_SAFETY_SEND_WINDOW_SECONDS`
  (default 1000 sends per 30 days) cap verification-email sends. The budget is
  consumed only when a send is actually attempted, so rate-limited or blocked
  requests cannot exhaust it. At the cap, `POST
/api/auth/ucsd/request-verification` returns
  `503 VERIFICATION_SENDS_PAUSED` before any provider call.
- `APPLICATION_SAFETY_ACCOUNT_WRITE_LIMIT` /
  `APPLICATION_SAFETY_ACCOUNT_WRITE_WINDOW_SECONDS` (default 50000 writes per
  30 days) cap authenticated account mutations. At the cap, non-GET planning
  routes return `503 ACCOUNT_WRITES_PAUSED`. Anonymous requests are rejected
  with `401` before consuming the budget.

At the safety budget the system never enables a development verification
code, never deletes Sessions or user data (verify of an already-sent code,
current-user reads, GET planning reads, and logout keep working), and never
takes down the public Catalog. There is no automatic plan upgrade path.

Both safety budgets emit their own maintainer signals before failing closed:
a structured `safety-budget-signal` warning log when consumption crosses 70
percent (attention) or 90 percent (urgent) of the configured limit, carrying
the deployment identity when deployed.

## Usage signals

The Worker keeps application-side monthly usage counters in Upstash
(`usage:{provider}:{YYYY-MM}`, expiring after 40 days) and classifies them
against configured allowances: maintainer **attention at 70 percent** and
**urgent review at 90 percent** of each allowance or budget.

| Provider | Unit counted                                                                                                                                     | Allowance variable                      | Default and basis                                                                                                                                |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Workers  | Worker requests served                                                                                                                           | `USAGE_ALLOWANCE_WORKER_REQUESTS`       | 10,000,000 (Workers Paid included requests per month)                                                                                            |
| R2       | R2 `get` operations on the Catalog path                                                                                                          | `USAGE_ALLOWANCE_R2_READS`              | 10,000,000 (R2 free Class B operations per month)                                                                                                |
| Neon     | Account requests opening an App DB client                                                                                                        | `USAGE_ALLOWANCE_NEON_ACCOUNT_REQUESTS` | 200,000 (application budget; Neon's 100 CU-hour free compute allowance is not application-observable, so an account-request budget stands proxy) |
| Upstash  | Upstash commands the application issues (store commands counted exactly per account request, plus each request's single usage-recording command) | `USAGE_ALLOWANCE_UPSTASH_COMMANDS`      | 500,000 (Upstash free monthly command quota)                                                                                                     |
| Resend   | Verification email send attempts                                                                                                                 | `USAGE_ALLOWANCE_RESEND_SENDS`          | 3,000 (Resend free monthly email quota)                                                                                                          |

Signals surface in two non-sensitive maintainer channels:

- a structured `usage-signal` warning log when the recording that crosses the
  70 or 90 percent threshold succeeds, including the deployment identity from
  the `CF_VERSION_METADATA` binding when deployed; and
- a daily `usage-report` warning log from the existing `0 8 * * *` Cron
  Trigger listing every provider's used count, allowance, and level (or
  `usage-report-unavailable` when the signal store cannot be read). The daily
  report is the backstop for a crossing signal lost to a swallowed recording
  failure.

Usage signals are advisory. Recording failures are swallowed, an unconfigured
signal store disables recording, and signal-store writes never change request
behavior or take down the Catalog. Every request records all of its touched
providers in one batched Upstash command — Catalog and static requests
included — and that command is itself counted in the Upstash usage above, so
public traffic cannot silently spend the Upstash quota. Provider-side billing
alerts (issue #84) complement these application signals and do not replace
the application controls.

## Failure and rollback evidence

- `bun run validate:failure-safety` drives the actual Worker composition
  through the complete provider-failure matrix, the safety-budget fail-closed
  path, Catalog isolation, and failure-state route negatives, then prints one
  evidence line recording deployment identity (short Git commit, schema
  version, Worker config) and non-sensitive outcomes.
- `api/drizzle/test-migrate.sh` proves fresh migration, idempotent rerun, and
  the current plus previous (pre-#114) Worker contracts against the expanded
  schema, then prints a rollback evidence line with both Worker commits and
  the schema version.
- Both evidence lines pass `assertGeneralTelemetrySafe` before printing, so
  they contain no PII, verification code, Cookie, Session, or secret.

Executing an actual staging rollback (redeploying a recorded prior Worker
version) belongs to the auditable deployment workflow in issue #117; this
slice proves and records that the previous application revision still
operates against the forward-compatible schema, so that rollback is safe
when #117 performs it.

## Local verification

```sh
bun run --cwd api test
bun run test:worker
bun run typecheck
bun run build:worker
bun run validate:failure-safety
bun run validate:worker-catalog
bun run validate:core-backend
api/drizzle/test-migrate.sh
```

Current provider references used for the documented allowances: Cloudflare
Workers Paid plan limits and version metadata binding, Cloudflare R2 free
tier operations, Neon free plan compute allowance, Upstash Redis free tier
command quota, and Resend free tier quotas and `429` quota error semantics.

## Post-review amendments (2026-07-12)

The independent implementation review identified three gaps in the first local
revision. This revision closes them while preserving the original boundaries:

- Global-send and Application Safety Budget read-only preflights now run after
  the per-source admission but before creating a Neon verification reservation.
  Once either cap is already exhausted, a distributed request therefore cannot
  create or fail a verification row. The atomic budget consumptions remain
  after the cooldown reservation, so cooldown-blocked requests still do not
  consume send capacity. A request that races with another in-flight request
  can still lose the later atomic consumption and have its own reservation
  marked failed; that bounded race does not permit continuing writes after the
  stored cap is visible.
- The daily scheduled event records its Worker invocation, Neon audit-cleanup
  access, the actual number of Upstash report reads attempted, and the one
  batched usage-recording command. A partial report failure records only the
  reads that were actually attempted before failure.
- The shared memory Redis recognizes the exact exported Lua script constants.
  Unknown or changed scripts fail explicitly instead of selecting behavior by
  `includes(...)` checks or key-count heuristics, so test-model drift cannot
  silently produce acceptance evidence.

## Protected provider-failure drills (2026-07-13)

Issue #85 adds a protected, manually dispatched Staging workflow for the two
provider failures that can be exercised with reversible credentials: Resend
and Upstash. The workflow proves the selected commit is reachable from
`main`, captures the accepted Worker, deploys a temporary version with only
the selected provider credential invalidated, checks the public failed-closed
response and Catalog isolation, and restores the accepted Worker in an
exit/signal trap before running the hosted smoke again. Deploy, exercise, and
restore share the one approved Staging job; every network command has a shorter
deadline than the step and job, so recovery does not wait behind a second
environment approval. It never prints the synthetic address or any credential
value. The rollback runs before any unrelated Catalog restoration, so an R2
restoration failure cannot strand the temporary Worker. Neon and R2 remain
required but incomplete: safely exercising them needs dedicated disposable
provider resources rather than mutation of the shared Staging connection or
bucket.
