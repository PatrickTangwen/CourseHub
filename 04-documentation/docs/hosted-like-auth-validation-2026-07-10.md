# Hosted-like authentication validation (2026-07-10)

This note records the disposable acceptance path added for issue #82. It
supplements the older Beta-1 validation notes; it does not replace their
historical development-mode procedure.

## Boundary being tested

The hosted-validation overlay starts a dedicated validation composition root
with `NODE_ENV=production`, Postgres App DB persistence, and Redis-backed
sessions. The normal server composition root always constructs the Resend
sender in production and has no environment switch for capture delivery. Only
`server.hostedValidation.ts`, selected explicitly by the validation overlay,
installs the capture sender before loading the server.

The capture sender writes one mode-`0600` file inside the disposable API
container. The validator reads the code internally, deletes the file, and uses
the code for the API verification request. The request-verification HTTP
response must not contain `devCode`, and the run fails if the capture is absent.
No email is sent and no Resend API key is needed.

## Run

Use an isolated Compose project and non-conflicting local ports when another
development stack is active. The API's production cookie expects HTTPS at its
trusted reverse-proxy boundary. For direct disposable-container validation,
set `TRUSTED_PROXY_CIDRS` to the exact local Docker network CIDR and the
validator supplies `X-Forwarded-Proto: https`.

```sh
COURSETABLE_AUTH_PROJECT=coursetable-auth-validation \
  TRUSTED_PROXY_CIDRS=<local-docker-network-cidr> \
  api/compose/hosted-validation-up.sh

COURSETABLE_AUTH_PROJECT=coursetable-auth-validation \
  bun run validate:real-backend-auth --api-origin http://localhost:3000

COURSETABLE_AUTH_PROJECT=coursetable-auth-validation \
  api/compose/hosted-validation-down.sh --volumes
```

The acceptance covers request-verification, the required sender call, code
verification, App User ID foreign-key ownership, Saved Search and Saved
Worksheet isolation from a second App User, current-user session restoration,
same-email re-login without a duplicate App User, Redis session
presence/removal, and logout.

Evidence artifacts intentionally contain only HTTP status values, booleans,
counts, and one-way fingerprints. They omit verification codes, cookies, API
keys, raw App User IDs, full Redis keys, and database rows.

The validator removes capture files in a `finally` path and treats cleanup
failure as a failed run. Its CLI also tears down the disposable Compose project
and volumes after both successful and failed runs. Failure artifacts contain
only a bounded failure category and already-collected status fields; raw HTTP
response bodies and thrown provider details are never persisted.
