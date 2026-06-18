# ADR-0003: Anonymous users with localStorage persistence

## Status

Accepted

## Context

The planner needs to persist user course selections. Options considered:

1. **Full auth (NextAuth.js + OAuth)** — allows cross-device sync, "my plans" list. But adds complexity and a login wall for a tool students want to use quickly.
2. **Fully anonymous + localStorage** — zero friction, but plans are device-bound and lost on clear.
3. **Anonymous + shareable links** — localStorage for active editing, Postgres for shared snapshots.

## Decision

Option 3: anonymous users with localStorage for active plans, Postgres for shared plan snapshots.

- No login, no authentication, no user accounts.
- Active planner state lives in `localStorage` under a stable key.
- "Share" action serializes the plan to JSON, writes it to `shared_plans` table with a nanoid, returns `/share/[id]` URL.
- Shared plans are read-only snapshots — the viewer cannot edit them.

## Consequences

- Zero-friction UX: students open the site and start planning immediately.
- No cross-device sync — acceptable for the portfolio project scope.
- Shared plans may accumulate without cleanup (consider `expiresAt` column for future TTL).
- No "my plans" list — the user manages their own bookmarks if they want to revisit a shared link.
