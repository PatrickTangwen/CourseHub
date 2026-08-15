# Local Server Endpoints, Containers, And Certificates

Status: current operator notes for opening the local SunGrid server.

Use this document when you need the exact local frontend/backend URLs, container
shape, HTTPS certificate behavior, or `mkcert` recovery path. For the shorter
startup runbook, see [`local_server.md`](local_server.md).

## Default Local URLs

Run the auth-aware local stack as an HTTPS pair:

```text
Frontend app:       https://localhost:3001
Catalog page:       https://localhost:3001/catalog
Worksheet page:     https://localhost:3001/worksheet
Login page:         https://localhost:3001/login
Privacy page:       https://localhost:3001/privacypolicy

Backend/auth API:   https://localhost:3000
API health check:   https://localhost:3000/api/ping
Auth session check: https://localhost:3000/api/auth/current-user
```

Keep these environment variables aligned:

```text
Frontend process:
  FRONTEND_ENDPOINT=https://localhost:3001
  VITE_API_ENDPOINT=https://localhost:3000

Backend compose stack:
  FRONTEND_ENDPOINT=https://localhost:3001
  API_PORT=3000
```

Do not run Vite on port `3000`. Port `3000` belongs to the backend/auth API.
The frontend should normally use `https://localhost:3001`.

Use `localhost` for browser login smoke tests. Cookies, CORS, and redirects are
configured around the `localhost` frontend/backend pair. `127.0.0.1` may load
assets, but it is not the preferred login smoke origin.

## Start The Stack

From the repository root:

```bash
bun install

FRONTEND_ENDPOINT=https://localhost:3001 api/compose/local-validation-up.sh
FRONTEND_ENDPOINT=https://localhost:3001 api/compose/local-validation-schema.sh

FRONTEND_ENDPOINT=https://localhost:3001 \
VITE_API_ENDPOINT=https://localhost:3000 \
bun run --cwd frontend start -- --host 127.0.0.1
```

Run the frontend command in a separate terminal and keep it alive while using the
browser.

## Container Shape

The backend/auth stack is Docker Compose based. The wrapper scripts use:

```text
Compose project: coursetable-auth-validation
Env file:        api/compose/local-validation.env.example
Compose files:   api/compose/docker-compose.yml
                 api/compose/dev-compose.yml
                 api/compose/local-validation-compose.yml
```

Default containers and host ports:

| Role            | Container                  | Host URL / Port          |
| --------------- | -------------------------- | ------------------------ |
| API/auth server | `coursetable-auth-api`     | `https://localhost:3000` |
| Hasura GraphQL  | `coursetable-auth-graphql` | `http://localhost:8085`  |
| Postgres        | `coursetable-auth-db`      | `localhost:5432`         |
| Redis           | `coursetable-auth-redis`   | internal compose network |
| pgAdmin         | `coursetable-auth-pgadmin` | `http://localhost:8081`  |
| Bun debugger    | API container              | `localhost:6499`         |

Useful container commands:

```bash
api/compose/local-validation-status.sh
docker ps --filter name=coursetable-auth
docker logs -f coursetable-auth-api
api/compose/local-validation-down.sh
```

To remove disposable local validation volumes:

```bash
api/compose/local-validation-down.sh --volumes
```

## HTTPS Certificates

Both the backend and frontend read the same ignored, machine-local HTTPS
certificate pair:

```text
.local-certs/localhost-key.pem
.local-certs/localhost-cert.pem
```

The API server reads these paths from inside the API container:

```text
/usr/src/app/.local-certs/localhost-key.pem
/usr/src/app/.local-certs/localhost-cert.pem
```

The frontend Vite dev server reads the repository path directly from
`frontend/vite.config.ts`. Each maintainer generates a local `mkcert`
development certificate for:

```text
DNS:localhost
IP:127.0.0.1
IP:::1
```

It is intended only for local development. The certificate and its private key
must never be committed or treated as production credentials.

## mkcert Trust Setup

If the browser reports `ERR_CERT_AUTHORITY_INVALID`, the most common cause is
that this machine does not trust the local `mkcert` root CA that issued the
certificate.

Install and trust the local CA:

```bash
brew install mkcert nss
mkcert -install
```

`mkcert -install` installs the local development CA into supported local trust
stores. The repository setup command installs the CA and generates the
certificate pair:

```bash
bun run local:https:setup
```

Node-based tools may need the mkcert CA explicitly:

```bash
export NODE_EXTRA_CA_CERTS="$(mkcert -CAROOT)/rootCA.pem"
```

Most local API smoke checks can avoid trust-store issues by using curl's
insecure-local flag:

```bash
curl -ksS https://localhost:3000/api/ping
curl -ksS \
  -H 'Origin: https://localhost:3001' \
  https://localhost:3000/api/auth/current-user
```

## Regenerate Local Certificates

Regenerate certificates when they are missing, expired, or intentionally
rotated. The supported command is:

```bash
bun run local:https:setup
```

Keep `.local-certs/` ignored. It contains a private key. The standard Compose
development configuration mounts this directory read-only, so no override file
or copy into `api/src/keys/` is required.

## Login Smoke

The local validation stack does not send real email. In development, the UCSD
email verification endpoint returns a development-only `devCode`.

Smoke path:

1. Open `https://localhost:3001/login`.
2. Enter a direct `@ucsd.edu` email address.
3. Submit the verification request.
4. Use the development verification code returned by the local stack.
5. Confirm the app shows signed-in state and saved worksheet/search features are
   reachable.

Scripted validation:

```bash
bun run validate:real-backend-auth
```

## Quick Troubleshooting

If the frontend loads but login fails:

- Confirm the API is on `https://localhost:3000`.
- Confirm the frontend is on `https://localhost:3001`, not port `3000`.
- Confirm `VITE_API_ENDPOINT=https://localhost:3000`.
- Confirm backend compose was started with
  `FRONTEND_ENDPOINT=https://localhost:3001`.
- Use `localhost` in the browser, not a mixed `127.0.0.1` origin.

If the browser still looks stale after restart:

- Open a fresh tab.
- Hard refresh the page.
- Stop old preview/dev processes that may own nearby ports.
- Restart Vite.

If the in-app browser cannot trust the local HTTPS dev origin, use the normal
Chrome browser after `mkcert -install`, or use the HTTP static-preview fallback
only for catalog-only visual checks.
