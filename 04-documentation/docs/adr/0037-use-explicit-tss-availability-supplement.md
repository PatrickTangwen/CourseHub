# Use An Explicit TSS Availability Supplement

Status: accepted. Extends ADR 0036 for incomplete or misaligned TSS enrollment
fields.

## Decision

The TSS Published Snapshot pipeline may read
`capacity_enrollment_supp.txt` from the raw JSON directory. The supplement is a
source artifact, not a generated patch to the JSON files.

The parser supports the observed comma- and tab-delimited blocks by reading
their headers rather than relying on fixed column positions. It normalizes
Unicode hyphens and spaces, validates nonnegative integer counts, and requires:

`capacity - available seats = enrolled`

Records join to TSS components by normalized subject, course number, and
section code. A matched supplement record is authoritative for `capacity`,
`enrolled`, and `seats_available`, including correction of a non-null raw value
that was placed in the wrong field. The pipeline reports match, component,
override, and unmatched counts.

## Constraints

- Duplicate supplement identities and internally inconsistent counts fail the
  pipeline.
- Unmatched records remain explicit audit entries. They do not create sections
  because the supplement lacks event IDs and meeting data.
- Existing raw JSON remains unchanged and reviewable.
- ADR 0036 timestamp and availability-verification gates still apply.

## Consequences

The supplement can complete availability for existing schedule components
without inventing calendar structure. A source section that exists only in the
supplement requires a separate complete schedule record before it can appear as
a frontend section.
