# Introduce Snapshot-Static Availability Data

Supersedes ADR 0004 (Exclude Availability And Demand Data).

## Decision

The platform will include enrolled count, seat capacity, and waitlist count for
each section in the Catalog Snapshot. These fields are scraped from the UCSD
Schedule of Classes at snapshot-generation time and treated as static values —
they are never refreshed in real time during a user session.

## Why the change

The SunGrid catalog redesign requires seat context in two places:

- **Catalog list view**: a seats column with enrolled/capacity text and a
  color-coded micro progress bar (green < 60%, blue 60–89%, red ≥ 90%).
- **Course detail modal**: per-section availability labels ("87 seats",
  "FULL · WL(1)") next to each selectable discussion or lab row.

Without this data the catalog list and modal lose a key planning signal. Users
routinely check seat availability when deciding which section to add to their
worksheet. ADR 0004 excluded this data because it is dynamic and easy to misread
as real-time availability. The constraint below addresses that risk directly.

## Constraint

Every UI surface that displays availability data must show the snapshot
timestamp (e.g., "Updated 2 days ago") derived from the snapshot's
`generated_at` field. The platform must not present seat counts as live or
real-time data.

## Scope

New snapshot section fields:

- `enrolled` — number of students currently enrolled at snapshot time.
- `capacity` — total seat capacity.
- `waitlist_count` — number of students on the waitlist (0 when no waitlist).

FULL status is derived: `enrolled >= capacity`. Waitlist display: when
`waitlist_count > 0`, show `FULL · WL(N)`.

## What remains excluded

ADR 0004's exclusion of the following product directions still holds:

- Seat availability history or trends
- Real-time WebReg availability polling
- Enrollment tracker or demand signals
- Worksheet demand ("in N worksheets")
- Friends taking course
- Availability-based sorting or filtering

These are intentionally excluded product directions, not deferred features.

## Pipeline changes required

1. `scheduleOfClasses.ts` — parse enrolled, capacity, and waitlist fields from
   the Schedule of Classes HTML table.
2. `catalogSnapshot.ts` — remove enrolled/capacity/waitlist from the excluded
   field validation list; add to the section schema.
3. `ucsdCatalogSnapshot.ts` — add `enrolled`, `capacity`, `waitlist_count` to
   the frontend `UcsdSection` type.

## Trade-offs

- Stale data risk: snapshot seat counts may be hours or days old. The timestamp
  label mitigates this but does not eliminate the risk of a user acting on
  outdated availability.
- Scraper fragility: UCSD may change the HTML structure of seat data. The
  scraper should fail hard (per ADR 0005) rather than silently omit seats.
