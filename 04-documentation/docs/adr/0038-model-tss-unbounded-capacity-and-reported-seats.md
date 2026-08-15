# Model TSS Unbounded Capacity And Reported Seats

Status: accepted. Refines ADR 0036 and supersedes ADR 0037 where the
availability supplement lacks an explicit enrolled value or uses a sentinel
limit.

## Decision

`Seats_Available` is the authoritative open-seat observation. Consumers use it
before falling back to `capacity - enrolled`. The supplement parser uses an
explicit `Enrolled` column when present and otherwise preserves a usable value
already present in the raw TSS response. It does not infer an enrolled total
from the other two fields and does not require the three values to satisfy an
arithmetic identity.

TSS values `9999` and `99999` in either capacity or available seats represent
an effectively unbounded section rather than a literal student limit. A
Published Snapshot records this as:

- `capacity_kind: effectively_unbounded`
- `capacity: null`
- `available_seats: null`
- the observed sentinel in `reported_capacity` or
  `reported_seats_available`

The Catalog list and Course modal display `Open · no fixed cap` for these
sections. Sentinel values do not contribute to capacity totals, availability
percentages, or progress bars.

When a supplement block has a Status column, `AC` or `Active` is accepted.
Blank or absent status remains unknown. Any explicit unsupported status fails
the pipeline so a cancelled or inactive row cannot silently publish active
availability.

## Constraints

- Existing snapshots without `capacity_kind` remain valid.
- Bounded values continue to publish numeric capacity and available seats.
- Effectively unbounded values preserve their reported sentinel for audit but
  never expose it as a literal capacity or open-seat count.
- Blank instructor fields remain unknown and never replace schedule meeting
  instructors.
- Blank waitlist fields remain `null`, not zero.
- Availability timestamp behavior is unchanged.

## Consequences

The frontend reflects what TSS reports instead of reconstructing a potentially
different open-seat count. Independent study, research, and similar sections no
longer appear to have thousands of literal seats, while the original source
value remains inspectable in the Published Snapshot.
