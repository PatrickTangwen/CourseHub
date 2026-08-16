# Preserve TSS Coverage And Seat Source Semantics

Status: accepted. Refines ADR 0011 for TSS-backed FA26 snapshots.

## Decision

The TSS Published Snapshot pipeline preserves source information that has a
direct Course Planning meaning instead of reconstructing or discarding it.

Subject coverage is determined per raw response:

- `requested_course` records which subjects were queried, including subjects
  that returned no offerings.
- A requested subject counts as covered only when `coverage.complete` is true,
  `coverage.continuation_needed` is false, and `omitted_courses` is empty.
- A configured subject that has no qualifying response keeps the aggregate
  snapshot partial.

Section availability may include optional `available_seats` alongside the
ADR 0011 fields. When TSS provides `seats_available`, the pipeline publishes
that exact snapshot-static value. The frontend uses it first and falls back to
`capacity - enrolled` only when the direct value is absent and both operands
are known. It does not invent enrollment or capacity values.

For a booking choice with multiple required components, available seats are
published only when every required component provides a value; otherwise the
choice remains unknown. Both the direct TSS adapter and Published Snapshot
adapter normalize omissions and contradictory coverage booleans to partial.

## Why

An empty `courses` array can mean either a complete query with no offerings or
an incomplete response. The request and coverage fields distinguish those
cases. TSS can also provide an available-seat count while withholding enrolled
and capacity totals; dropping that count makes valid source data appear
unknown.

## Constraints

- Availability remains a timestamped static snapshot, never a live value.
- `availability_verified` and `availability_timestamp` continue to gate all
  availability display. Validation rejects verified availability when neither
  a section timestamp nor the schedule source timestamp exists.
- No availability history, polling, sorting, filtering, or inferred enrollment
  totals are introduced.

## Consequences

Older snapshots without `available_seats` remain valid and retain the existing
derived-seat behavior. Raw responses that declare continuation or omissions
remain visibly partial even if their files are present.
