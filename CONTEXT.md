# CourseHub Domain Context

## Glossary

Terms used consistently across the codebase. Prefer these over synonyms.

| Term | Definition | Avoid |
|------|-----------|-------|
| **Course** | A UCSD academic course identified by department code + number (e.g., "CSE 101"). Has a title, unit count, description, and prerequisites. | "class", "section" |
| **Department** | An academic department identified by a short code (e.g., "CSE", "ECE", "MATH"). Contains many courses. | "school", "faculty" |
| **Professor** | An instructor identified by name. Teaches course offerings across terms. | "instructor", "teacher" |
| **GradeDistribution** | A record of grade outcomes for a specific course + professor + term combination. Contains per-letter-grade counts (A+ through F), pass/no-pass/satisfactory/unsatisfactory/withdrawn counts, total students, and class GPA. | "grades", "grade report" |
| **Term** | A UCSD academic quarter, formatted as "{Season} Qtr {Year}" (e.g., "Fall Qtr 2023") or "{Session} {Year}" for summer (e.g., "Sum Ses II 2023"). | "semester", "period" |
| **Plan** | A user-created course schedule organized as Year (1-4) × Quarter (Fall, Winter, Spring, Summer). Each slot holds zero or more courses. Stored in localStorage on the client. | "schedule", "calendar" |
| **SharedPlan** | A Plan that has been persisted to Postgres with a nanoid identifier. Accessible via `/share/[id]` URL. Read-only for viewers. | "published plan", "saved plan" |
| **Interactive Planner** | The drag-and-drop mode of the planner, powered by dnd-kit. Users drag course cards from a search panel into quarter slots. | "drag planner" |
| **Classic Planner** | The table-based mode of the planner. Users type course codes into a grid of input fields. | "table planner", "simple planner" |

## Key relationships

- A **Department** has many **Courses**.
- A **Course** has many **GradeDistributions** (one per professor-term combination).
- A **Professor** has many **GradeDistributions** across different courses and terms.
- A **Plan** contains course references organized by year and quarter.
- A **SharedPlan** is a serialized snapshot of a Plan with a unique ID.

## Data flow

```
catalog.ucsd.edu  ──scrape──▸  Postgres (courses, departments)
sheet.csv         ──import──▸  Postgres (grade_distributions, professors)
Postgres          ──SSG─────▸  Static course/department pages (build time)
Postgres          ──API─────▸  Search results, shared plans (runtime)
localStorage      ◂──────────  Active planner state (client only)
localStorage      ──share──▸   Postgres (shared_plans) ──▸ /share/[id]
```
