# Use Versioned Drizzle Migrations For Shared Databases

Status: accepted. Clarifies the database rollout boundary from ADR 0009.

Shared staging and production App DB schema changes must use versioned Drizzle
migrations rather than `drizzle-kit push`. Direct schema push remains acceptable
only for disposable local validation databases where data loss and implicit
schema drift are expected. Hosted login and saved-user-data rollout needs an
auditable migration history before real UCSD users depend on the App DB.

**Consequences**

- The existing `drizzle-kit push` workflow is a launch blocker for shared
  staging and production App DB rollout.
- Implementation should add generated migration files and a hosted migrate
  command path before production login is public.
- Local validation scripts may keep using direct push against disposable Compose
  volumes, but docs and CI must not present that as the shared database path.
