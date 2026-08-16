# Email Delivery Audit and hosted telemetry privacy (2026-07-11)

Status: local implementation and contract acceptance for issue #114. No hosted
provider resource, secret, database, or production configuration was created or
modified by this change.

## Operational separation

Email Delivery Audit is a maintainer-only App DB record, not a general log. Each
row contains exactly normalized recipient email, request ID, nullable provider
message ID, request time, delivery outcome, and expiration time. It contains no
verification code or hash, Cookie, Session, email body, request body, provider
credential, or connection string.

The Resend adapter remains the delivery seam. The audit wrapper writes the
`requested` row before calling Resend, then records `sent`,
`definitive_failure`, or `ambiguous`. A sent outcome includes the Resend message
ID. Rows expire seven days after request time.

## Cleanup scheduling

The Worker declares `0 8 * * *` in `worker/wrangler.jsonc`. Its module-syntax
`scheduled` handler deletes rows whose expiration time is at or before the
scheduled event time and always closes the Hyperdrive-backed client. Repeating
the same cleanup is safe and returns zero after the first deletion.

`bun run build:worker` verifies that Wrangler accepts the handler and cron
configuration without deploying or changing Cloudflare state.

## Maintainer lookup

There is no browser route for Email Delivery Audit. A maintainer with controlled
direct App DB access can query recent rows by piping the recipient through
stdin, keeping it out of shell history:

```sh
printf '%s\n' '<recipient>' | NEON_DIRECT_DATABASE_URL='<secret>' \
  bun run --cwd api email-delivery-audit:lookup
```

The command deliberately prints only the six-field audit records. Treat that
output as restricted delivery-support data, not as acceptance evidence or a
general application log.

## General telemetry and evidence

Sentry applies explicit recursive scrubbing in `beforeSend`. Winston uses the
same scrubber before formatting. Complete emails, verification codes and
hashes, Cookies, Session IDs, request bodies, connection strings, and
credentials are removed. When recipient correlation is required, callers use
masked email plus an HMAC reference derived from an environment-specific key.

Hosted-like validation artifacts pass through the same privacy assertion before
being written. Their recipient evidence is limited to masked email and an HMAC
reference. `TELEMETRY_HMAC_KEY` in the disposable validation env file must be
different for each hosted environment when a human provisions it. Deployment
asset tests reject environment-dump commands and shell tracing.

## Local verification

```sh
bun run --cwd api test
bun run test:worker
bun run typecheck
bun run build:worker
bun run validate:worker-catalog
bun run validate:core-backend
```
