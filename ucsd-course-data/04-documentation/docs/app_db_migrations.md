# App DB Migrations

Status: stable shared-database rollout runbook. Added 2026-07-10 for issue #77.

The App DB schema is declared in `api/drizzle/schema.ts`. Shared staging and
production databases must be changed only by committed migrations under
`api/drizzle/migrations/`. Do not use `db:push` against a shared database.

## Create a migration

After changing the schema, generate and inspect the SQL before committing it:

```bash
bun run --cwd api db:generate
```

Commit the schema change, generated SQL, and migration metadata together.
Generation does not connect to a database and does not require a real
`DB_URL`.

## Apply migrations to a shared database

Use the manually dispatched `DB Migration` GitHub Actions workflow and choose
`staging` or `production`. The workflow obtains `DB_URL` from that environment's
secret configuration and runs:

```bash
bun run --cwd api db:migrate
```

Drizzle records completed migrations in the database, so rerunning the command
applies only migrations that have not yet run. Apply and verify staging before
selecting production.

## Verify the command path locally

The normal API test suite executes the real `db:migrate` command without
`DB_URL` and verifies that it resolves correctly and fails closed before making
a connection. To exercise the complete command against an isolated Postgres,
including its schema, migration journal, and safe rerun, use:

```bash
api/drizzle/test-migrate.sh
```

The script starts a temporary `postgres:13` container on a random localhost
port and removes it on completion. It uses only generated test credentials and
does not read hosted secrets.

## Disposable local validation

`bun run --cwd api db:push` remains available only for throwaway local Compose
databases. The checked-in `api/compose/local-validation-schema.sh` wrapper is
intentionally scoped to that disposable environment. It is not a staging or
production rollout command.
