# Beta-1 Real Backend Auth Validation Plan

Status: planned follow-up validation for issue #20, after issue #14.

This document is a validation plan, not the command-level runbook. It captures
the stable target for `Beta-1: Real Backend Auth Validation`; issue #20 should
turn this plan into reusable scripts, local environment templates, artifacts,
and a concrete runbook after the full local Compose path is proven.

## Purpose

`Beta-1: Real Backend Auth Validation` proves that UCSD User Identity and App DB
ownership work against the full local CourseTable Docker Compose backend stack
before production-like email delivery.

This is validation and launch preparation for the Auth Foundation, not a new
product capability and not Saved Worksheet persistence.

## Source Links

- Parent PRD: #12
- Auth foundation implementation: #14
- Real backend validation issue: #20
- Decision record: `docs/adr/0009-stage-real-backend-auth-validation-before-email-delivery.md`
- Roadmap pointer: `docs/planning/archive/post-mvp-roadmap.md`

## Scope

- Validate the auth path against the full local CourseTable Docker Compose
  backend stack: API container, Postgres, Redis-backed sessions, Hasura, and
  pgAdmin.
- Use a dev/test verification-code seam; do not connect a real email provider.
- Use the development-only `devCode` response field to complete verification in
  the repeatable script.
- Do not recover verification codes from DB hashes, logs, or synthetic inboxes.
- Confirm non-development environments do not expose verification codes.
- Verify Saved Search ownership by internal `user_id`.
- Require a repeatable auth/API verification script plus a human-readable
  runbook.
- Run the verification script from the host machine against the API container's
  exposed port, not from inside the API container.
- Require a fresh-run path against an isolated disposable Compose project or
  data volume.
- Do not default to deleting a developer's existing `api/postgres/data`
  directory.
- Require the runbook to record compose service health/status before API
  verification.
- Allow `db:push` only from inside the API container against the disposable
  local Docker Postgres database.
- Require a versioned migration workflow before any shared, staging, or
  production database rollout.

## Environment Dependency Boundary

- Docker Desktop or equivalent Docker Engine is a required manual prerequisite.
- Doppler may be documented as the inherited CourseTable path for developers
  with project access.
- Doppler must not be the only validation path.
- The runbook must include a local env file/template path and a
  `docker compose --env-file ...` command path so the validation can run without
  CourseTable Doppler project access.

## Pass/Fail Definition

- `docker compose ps` must show the API container, Postgres, Redis, Hasura, and
  pgAdmin running; services with health checks should be healthy, and services
  without health checks should be reachable.
- API must answer `/api/ping`.
- Hasura must pass a simple HTTP health or access check.
- pgAdmin must serve its login page; pgAdmin is not the source of auth
  correctness.
- Postgres evidence should come from SQL checks for the expected tables,
  indexes, and auth/Saved Search rows.
- Redis evidence should come from session restore/logout behavior or
  Docker/Compose-based session-key inspection.
- The repeatable auth/API script remains the final pass/fail core for UCSD User
  Identity and App DB ownership.
- DB and Redis evidence may be collected with `docker compose exec` or
  `docker exec`; the HTTP auth flow should still target the exposed API port
  from the host.
- At least one final acceptance run must use a fresh empty Postgres database,
  apply the schema, and then run the full auth/Saved Search validation.
- Reusing an existing local Compose database may be documented as a shortcut,
  but it is not sufficient as the only acceptance evidence.
- The validation script should use unique test emails and Saved Search names,
  then either clean up after itself or leave clearly identifiable test data.
- Successful runs should clean up mutable test records such as Saved Searches
  and verification-code rows while printing a durable evidence summary.
- Preserving the generated test App User is acceptable in a disposable fresh
  database because it documents the user-creation path.
- Failed runs should preserve DB/Redis state for inspection.
- A `--keep-data` option may force successful runs to retain test data for
  manual inspection.

## Browser Smoke

A thin browser smoke must run against the frontend wired to the full local
Compose API container.

The smoke should cover:

- UCSD email sign-in with the dev verification seam.
- Signed-in navbar/account state.
- Signed-in Saved Search availability.
- Anonymous Worksheet behavior after login.
- Logout back to anonymous state.

Browser smoke is a user-path guard, not a visual regression suite. API/script
evidence remains the primary acceptance signal.

## Artifact Strategy

- Commit reusable validation assets: runbook, repeatable verification script,
  and local env template.
- Do not commit per-run evidence by default: logs, screenshots, evidence JSON,
  cookie jars, session artifacts, or local database dumps.
- Default per-run evidence output should live under a gitignored local artifacts
  directory such as `artifacts/real-backend-auth-validation/<timestamp>/`.
- Issue or PR updates should summarize the evidence and link or quote only the
  non-sensitive portions needed for review.

## Compose/Startup Change Boundary

- Fix only the Compose/startup pieces needed to make full local validation
  repeatable.
- Allowed changes include local env templates, Doppler-free Compose commands,
  small up/down/status wrappers, artifact ignores, and package-command fixes
  needed inside the API container.
- Do not rewrite the CourseTable Compose system, replace staging/production
  deployment flows, redesign Hasura/Ferry, solve unrelated upstream Docker
  issues, or introduce a new infrastructure platform.

## Worksheet Boundary

- A signed-in UCSD email session should continue using the existing Anonymous
  Worksheet behavior during this validation slice.
- The validation should catch accidental worksheet writes to the App DB.
- Logging in should not automatically save or sync the Anonymous Worksheet.
- Saving worksheet state to an account should be a later explicit product
  action.

## Follow-Up Product Slices

1. `Beta-1: Save Anonymous Worksheet To Account`
2. `Beta-1: Saved Worksheets List/Detail`

The first follow-up should let a signed-in user explicitly turn the current
Anonymous Worksheet into a Saved Worksheet. It should decide naming, term
conflict behavior, privacy defaults, and cross-browser restore behavior instead
of inheriting those decisions from login.

## Non-Goals

- Production-like email provider integration.
- Hosted staging or production rollout.
- Saved Worksheet persistence.
- Automatic Anonymous Worksheet save or sync on login.
- Google OAuth.
- Google Calendar export.
- SET/CAPE or personal UCSD account access.
- Course Data Store adoption.
- Hasura/Ferry redesign.
- General CourseTable Compose modernization.
