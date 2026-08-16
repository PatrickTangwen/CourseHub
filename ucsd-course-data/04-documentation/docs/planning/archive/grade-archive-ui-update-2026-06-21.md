# 2026-06-21 Grade Archive UI Update

Status: current context note for the UCSD Catalog Snapshot UI.

## What Changed

- The course modal now separates raw archive rows into a `Past Grades` tab next
  to `Overview`.
- The modal Overview shows `Average GPA` only; it does not show a `Record Count`
  card and does not render a `Grade Archive Records` heading.
- Catalog/search results still show `Average GPA` and `Record Count`.
- `Average GPA` is computed from matching Grade Archive Records in the most
  recent archive term with data, not across every matching archive row.
- `Record Count` remains the total number of matching Grade Archive Records
  across all terms.
- Past Grades rows are ordered by term descending.

## Compatibility Notes

- The snapshot field remains `archive_avg_gpa` for code/data compatibility, but
  current user-facing copy should say `Average GPA`.
- Use `Past Grades` when referring to the course-modal tab that contains raw
  Grade Archive Records.
- Treat older mentions of `Archive Avg GPA` in historical planning/archive docs
  as legacy wording unless they have been explicitly updated.
