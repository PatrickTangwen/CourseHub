# Local Server, Frontend, Backend, And Login

Status: stable local runbook for agents and maintainers.

Use this document when the task is to open, restart, verify, or debug the local
CourseTable/SunGrid server with login enabled.

## Default Local Shape

Run the full local auth stack unless the task is explicitly catalog-only.

```text
Backend/auth API: https://localhost:3000
Frontend:         https://localhost:3001
Frontend env:     VITE_API_ENDPOINT=https://localhost:3000
Login flag:       VITE_PUBLIC_LOGIN_ENABLED=true
Backend env:      FRONTEND_ENDPOINT=https://localhost:3001
```

Do not run Vite on port `3000`. Port `3000` is the auth API port. If Vite owns
that port, UCSD email verification and session restore will fail even if the UI
loads.

Use `localhost`, not `127.0.0.1`, for the default login smoke. Cookies, CORS,
and redirects are configured around the frontend/backend localhost pair above.

## Prerequisites

- Docker Desktop or an equivalent Docker Engine is running.
- Project dependencies are installed with Bun.
- `mkcert` is installed for local HTTPS.

If dependencies are missing:

```bash
bun install
```

Create the ignored, machine-local certificate pair before starting either
server:

```bash
bun run local:https:setup
```

The command writes only to `.local-certs/`. Never copy or commit its private
key. Both the API and Vite read this same certificate pair; Docker Compose
mounts it read-only into the development API container.

## Start The Backend/Auth Stack

From the repo root:

```bash
FRONTEND_ENDPOINT=https://localhost:3001 api/compose/local-validation-up.sh
FRONTEND_ENDPOINT=https://localhost:3001 api/compose/local-validation-schema.sh
```

The wrappers use `api/compose/local-validation.env.example` by default. That env
file is intentionally local-only and non-secret, but its checked-in
`FRONTEND_ENDPOINT` value may not match the HTTPS browser flow. Prefer the
command-line override above for login work.

If port `3000` conflicts, use a copied untracked env file or `API_PORT=<port>`.
When the backend port changes, the frontend `VITE_API_ENDPOINT` must change to
the same origin.

## Start The Frontend

In a second terminal, from the repo root:

```bash
FRONTEND_ENDPOINT=https://localhost:3001 \
VITE_API_ENDPOINT=https://localhost:3000 \
VITE_PUBLIC_LOGIN_ENABLED=true \
bun run --cwd frontend start -- --host 127.0.0.1
```

Open:

```text
https://localhost:3001
https://localhost:3001/login
https://localhost:3001/privacypolicy
```

The frontend dev server uses the machine-local `mkcert` certificate. A browser
warning means the local CA is not installed or trusted; rerun
`bun run local:https:setup` before bypassing certificate errors.

`VITE_PUBLIC_LOGIN_ENABLED` is fail-closed: only the exact value `true` exposes
public sign-in links and `/login`. Set it in the staging frontend build and
leave it unset or set it to `false` for production until hosted acceptance is
complete. This availability flag does not relax backend email configuration.

## Login Smoke

The local validation stack does not send real email. In development, the
verification request returns a development-only `devCode`; use that value to
complete login.

Browser path:

1. Open `https://localhost:3001/login`.
2. Enter a direct `@ucsd.edu` email address.
3. Submit the verification request.
4. Use the returned development verification code when the UI or tooling
   exposes it.
5. Confirm the app shows the signed-in state and account-owned worksheet paths
   work for the task under test.

Scripted API validation path:

```bash
bun run validate:real-backend-auth
```

If the API port is not `3000`:

```bash
bun run validate:real-backend-auth --api-origin https://localhost:<api-port>
```

The validation script uses the development-only `devCode` response field from
`/api/auth/ucsd/request-verification`; do not recover verification codes from
database hashes, logs, or inboxes.

## Health Checks

Use these checks before telling someone the local server is ready:

```bash
curl -ksS https://localhost:3000/api/ping
curl -ksS \
  -H 'Origin: https://localhost:3001' \
  https://localhost:3000/api/auth/current-user
```

Expected:

- `/api/ping` returns `pong`.
- `/api/auth/current-user` returns an anonymous response before login and an
  authenticated response after login in the same browser session.
- `https://localhost:3001/catalog`, `https://localhost:3001/worksheet`,
  `https://localhost:3001/login`, and
  `https://localhost:3001/privacypolicy` load from the same frontend origin.

## Common Failures

If login fails with `Failed while requesting ucsd email verification`, check:

- Docker backend/auth stack is still running.
- API is reachable at `https://localhost:3000`.
- Frontend is running at `https://localhost:3001`, not `https://localhost:3000`.
- Frontend was started with `VITE_API_ENDPOINT=https://localhost:3000`.
- Backend was started with `FRONTEND_ENDPOINT=https://localhost:3001`.
- The browser page is on `localhost`, not a mixed `127.0.0.1` origin.

If the browser looks stale after a restart, open a fresh tab or restart the
frontend dev server. Do not trust an old cached PWA/service-worker state when
verifying auth behavior.

## Stop The Stack

Stop services without deleting local validation volumes:

```bash
api/compose/local-validation-down.sh
```

Delete disposable validation volumes only when no run needs inspection:

```bash
api/compose/local-validation-down.sh --volumes
```
