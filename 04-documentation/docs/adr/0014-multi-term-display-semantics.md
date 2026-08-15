# Multi-Term Display Semantics: Term-State Availability And Course GPA Summary

Status: accepted. Refines ADR 0011 (availability) and supersedes the course-level
Average GPA summary of ADR 0003.

## Decision

1. **Availability staleness by term state.** Snapshot Availability Data
   (`enrolled` / `capacity` / `waitlist_count`) is shown for all terms, but the
   staleness treatment depends on term state:
   - Current / upcoming terms (inside the Term Window): show "Updated N days ago"
     derived from `generated_at`, as a near-term planning signal.
   - Frozen / past terms: show an explicit historical label (e.g. "As of
     <term end> · historical snapshot, not live"). Past-term seat counts are a
     "how full did it get last time" signal and must never be presented as
     actionable availability.

   Availability-based sorting and filtering remain excluded (ADR 0011).

2. **No single course-level GPA summary.** The catalog list and course card do
   not show one collapsed "Average GPA" number. Across multiple archived years a
   single number — especially the most-recent-term value the pipeline currently
   computes — is misleading. Historical GPA is presented only through the Past
   Grades detail (all archived years; 2021 is a floor, not a ceiling). This
   deliberately removes at-a-glance GPA comparison and GPA-based sorting in
   exchange for not publishing a misleading aggregate.

## Consequences

- `archive_avg_gpa` is dropped from the course card top line; the CONTEXT
  "Average GPA" term is superseded.
- The catalog table loses its single GPA column / GPA sort. If at-a-glance
  comparison is wanted later, replace the single number with a non-collapsing
  per-term distribution, not a mean.
- `Record Count` and `Past Grades` (ADR 0003) are unaffected.
