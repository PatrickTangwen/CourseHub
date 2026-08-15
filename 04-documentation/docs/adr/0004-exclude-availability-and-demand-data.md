# Exclude Availability And Demand Data

The product will not implement open seats, seat availability history, enrollment availability, waitlist availability, worksheet demand, or friends-taking-course features. UCSD Schedule of Classes exposes seats-related search behavior, and CourseTable has enrollment/demand concepts, but these data are dynamic and easy to misread as real-time availability; the platform is scoped as course discovery, historical GPA, and schedule planning rather than an availability tracker.

## 2026-06-26: Partially Superseded by ADR 0011

ADR 0011 introduces enrolled count, seat capacity, and waitlist count as
snapshot-static section fields. The seat-data exclusion no longer applies.

The following exclusions from this ADR remain in effect:

- Seat availability history or trends
- Real-time WebReg availability polling
- Enrollment tracker or demand signals
- Worksheet demand ("in N worksheets")
- Friends taking course
- Availability-based sorting or filtering
