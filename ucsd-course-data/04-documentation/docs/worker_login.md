# Worker UCSD Login

Status: local implementation and contract acceptance for issue #112. Provider
provisioning and real-mailbox acceptance remain human-owned work.

## Runtime shape

The hosted Worker serves login routes from the product origin under
`/api/auth/*`. The transport-neutral auth module is shared with the Node
composition. The Worker supplies these runtime adapters:

- `APP_DB_HYPERDRIVE_NO_CACHE` for App DB access through a dedicated
  cache-disabled Hyperdrive configuration;
- Upstash Redis REST for verification request/global/guessing budgets and
  fixed server-revocable sessions;
- Resend through the existing provider-neutral verification sender;
- a host-only `sungrid_session` cookie with `Secure`, `HttpOnly`,
  `SameSite=Lax`, `Path=/`, and a fixed thirty-day lifetime.

Ordinary current-user reads do not rewrite the cookie or Redis TTL. Logout
deletes the Upstash record before clearing the cookie. Missing or unavailable
account bindings return a bounded `503` response while static assets and the
public Catalog remain independent.

## Hyperdrive and migrations

Authentication and ownership-sensitive reads must use a Hyperdrive
configuration whose query cache is disabled. Hyperdrive caching is a provider
configuration property, not a per-query Worker option. During the later human
provisioning step, replace the all-zero placeholder ID in
`worker/wrangler.jsonc` and verify the selected configuration with:

```sh
wrangler hyperdrive update <staging-hyperdrive-id> --caching-disabled true
```

Do not run schema migrations through the Worker binding. Controlled hosted
migrations use the separate direct Neon secret contract:

```sh
NEON_DIRECT_DATABASE_URL='<secret>' bun run --cwd api db:migrate:hosted
```

`NEON_DIRECT_DATABASE_URL` belongs only in the controlled migration secret
store. It is not a Worker variable or secret. The existing local Node command
continues to use `DB_URL`.

## Worker configuration

`worker/wrangler.jsonc` records only non-sensitive binding names and budget
values. Before hosted acceptance, provision the cache-disabled Hyperdrive
configuration and set these Worker secrets without committing their values:

- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `SESSION_SECRET`
- `RESEND_API_KEY`
- `VERIFICATION_EMAIL_SENDER_DOMAIN`
- `VERIFICATION_EMAIL_FROM_ADDRESS`

Staging and production must receive separate values and state. Production
login remains unconfigured and disabled in this slice.

## Local acceptance

No provider resource or credential is needed for the local contract:

```sh
bun run test:worker
bun run typecheck
bun run build:worker
bun run validate:worker-catalog
bun run validate:core-backend
```

For the Docker validator's required local proxy CIDR and disposable environment
values, follow `docs/core_app_backend.md`; do not weaken the trusted-proxy
policy merely to make a Secure Cookie appear.

The same hosted login assertions run against an Express hosted-like
composition and the Worker Fetch composition. The contract covers verification
request, provider-compatible delivery, code consumption, App User creation,
fixed session creation, refresh restore without rolling renewal, logout, and
old-cookie rejection. Focused Worker tests cover non-UCSD, rate-limited,
provider-rejected, and dependency-unavailable behavior. Existing shared auth
tests retain invalid, expired, consumed, and guessing-limit coverage.
