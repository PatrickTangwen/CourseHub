# Local UCSD Course Data Platform

Status: operator runbook for the complete disposable local platform.

The supported completion workflow is:

```sh
bun run validate:local-platform
```

Add optional pgAdmin:

```sh
bun run validate:local-platform -- --with-pgadmin
```

The command requires Docker Compose and the representative Published Snapshot
inputs at `api/static/catalogs/public/S326.json` and
`api/static/catalogs/import-manifests/S326.json`. Generate or restore those
operational artifacts through the Catalog Snapshot publication workflow before
running acceptance; they remain Published Snapshot inputs rather than source
code.

## Owned disposable services

Each run generates a unique Compose project name and random App DB, session,
Course Data Store, Hasura, and optional pgAdmin credentials. The credentials,
auth evidence, and Compose env file live only in a mode-0600 temporary
directory. The workflow refuses a project name that already owns resources and
only tears down projects for which the current run acquired ownership.

| Boundary          | Service           | Host port     | Health evidence                                     |
| ----------------- | ----------------- | ------------- | --------------------------------------------------- |
| Core App Backend  | API               | run-allocated | `/api/ping`, auth and static Catalog smoke          |
| App DB            | Postgres 13       | internal      | Compose health plus migration rerun                 |
| Session store     | Redis 7           | internal      | Compose health and session create/logout evidence   |
| Course Data Store | Postgres 16       | run-allocated | migration, import, and row-count acceptance         |
| Shadow query      | Hasura 2.48.5     | run-allocated | health, metadata, permission, and parity acceptance |
| Public GraphQL    | anonymous gateway | run-allocated | bounded `/ferry/v1/graphql` queries                 |
| Administration    | pgAdmin 9.5       | run-allocated | optional `--with-pgadmin` profile                   |

The command prints its allocated ports in the final JSON result. Ports are
selected per run so an unrelated developer stack cannot be mistaken for or
blocked by the validation project.

The Core App Backend stack deliberately contains no Hasura service. Login,
Redis sessions, Saved Searches, Saved Worksheets, and static Published Snapshot
serving are validated first while Hasura is unavailable. The Course Data Store
and Hasura tracer then runs while that independent App stack remains healthy.

App DB migrations use `bun run --cwd api db:migrate`; Course Data Store
migrations use `bun run course-data:migrate`. The workflow reruns the App DB
migration and the Course Data tracer reruns its migration/import, proving the
commands are non-interactive and idempotent. Hasura metadata is applied from
`course-data-store/hasura/metadata.json` and fails closed.

Success and failure both execute `docker compose down --volumes
--remove-orphans` for owned projects and remove temporary credentials,
evidence, and capture files. If a run stops outside its `finally` handler,
inspect labels before cleanup:

Every normal acceptance run first injects an `after-up` failure into an
independently named Course Data project and then verifies by Compose labels that
no container, network, volume, or newly created tracer temp directory remains.

```sh
docker ps -a --filter label=com.docker.compose.project
docker volume ls
docker network ls
```

Never run `down` against a project you did not start. Prefer a new validation
run over reusing a developer project name.

## Staging-readiness contract for issue #84

This issue creates no hosted resources. A later staging design consumes these
explicit contracts:

- Frontend: `sungridplanner.com` origin and an explicit HTTPS API origin.
- Core App Backend: independently deployable API with App DB and Redis; no
  Hasura dependency for login or account-owned product data.
- App DB: private Postgres, versioned `api/drizzle` migrations, and App User ID
  ownership.
- Course Data Store: separate private Postgres, versioned
  `course-data-store/migrations`, and non-interactive Snapshot import.
- Hasura: Course Data Store only; admin secret confined to migration/metadata
  paths; browser traffic goes through the bounded anonymous API gateway.
- Catalog publication: Published Snapshot generation and static serving remain
  independent of Course Data Store import or Hasura availability.
- DNS/origins: separate frontend and API origins; any public GraphQL origin is
  optional and must preserve the gateway policy.
- Secrets: session signing, App DB, Redis, Hasura admin, Course Data Store, and
  email-delivery credentials are separate deploy-time inputs. No secret is
  shipped to the frontend.
- Email: Resend sender/DNS/key setup and real-email smoke remain manual #84
  work; this workflow uses the capture sender only.

The inherited `coursetable.com`, `master`, Doppler, self-hosted runner,
Traefik, and external-network deployment files remain historical audit inputs.
`docs/deployment.md` is explicitly marked inherited and is not a SunGrid
runbook. Do not adapt those assumptions implicitly; a hosted architecture must
be designed from the contracts above.
