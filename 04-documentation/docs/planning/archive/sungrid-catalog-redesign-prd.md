# SunGrid Catalog & Course Detail Redesign — PRD

Last updated: 2026-06-26

Design source: `design_handoff_catalog_course_detail/`

## Problem Statement

The current catalog and course detail UI is inherited from the Yale CourseTable
fork. It does not reflect the SunGrid product identity, uses Yale-centric
terminology and layout patterns, and lacks seat availability context that UCSD
students need for schedule planning. The inherited React Bootstrap component
library and system font stack do not match the high-fidelity SunGrid design
language.

## Solution

Implement the SunGrid Catalog List View and Course Detail Modal as a
pixel-faithful reproduction of the design handoff prototypes. This is a new
beta slice independent of Beta-0; the redesign replaces the entire app's visual
identity (brand, colors, typography) and rebuilds the catalog browsing and
course detail experience from scratch.

## User Stories

1. As a student browsing courses, I want to see a clean table of all available
   courses with code, title, instructor, schedule, location, and seat counts,
   so that I can quickly scan what is offered.
2. As a student, I want to search courses by code, title, instructor, or
   description in a single search bar, so that I can find courses without
   knowing the exact code.
3. As a student, I want to filter courses by subject (CSE, MATH, PHYS, ECE)
   and course level (Lower/Upper Division), so that I can narrow results to
   what I am eligible for.
4. As a student, I want to see active filter chips with a remove button and a
   reset-all button, so that I can quickly adjust my filters.
5. As a student, I want sortable table columns (code, title, meets), so that I
   can order results by what matters to me.
6. As a student viewing a course with multiple offering groups (e.g., CSE 29
   with families A and B), I want to see an expandable parent row with a
   "N sections" badge, so that I can explore each group without leaving the
   table.
7. As a student, I want the expanded sub-rows to show each offering group's
   shared lecture schedule, instructor, and aggregated seat availability, so
   that I can compare groups at a glance.
8. As a student, I want to click a course row or sub-row to open a full Course
   Detail Modal, so that I can see the complete schedule, description, and
   prerequisites.
9. As a student viewing the modal, I want to see all meetings grouped into
   Offering Group cards, with anchor rows (Lecture), selectable rows
   (Discussion or Lab with radio buttons), and info rows (Final/Midterm), so
   that I understand the full schedule combination I am choosing.
10. As a student, I want to select a discussion or lab section via radio button
    and see an "Add [section] to Worksheet" button appear, so that I can add
    the exact schedule combination I want.
11. As a student, I want the modal to show course description, units, level
    tags, prerequisite details (expandable), and a catalog link chip, so that I
    have full course context before deciding.
12. As a student viewing a multi-family course in the modal, I want section
    pills at the top that let me switch between offering groups and highlight
    the corresponding card, so that I can quickly compare options.
13. As a student, I want to see seat availability per section in the modal
    (e.g., "87 seats" or "FULL · WL(1)"), so that I know which sections
    still have room.
14. As a student, I want all seat data labeled with a "Updated N days ago"
    timestamp, so that I know the data is from a snapshot and not real-time.
15. As a student, I want to close the modal by clicking the backdrop, the X
    button, or pressing Escape, so that I can return to browsing.
16. As a student, I want a floating action button (FAB) in the bottom-right
    that navigates to my worksheet, so that I can quickly switch views.
17. As a student, I want the + button on each row to add that section to my
    worksheet without opening the modal, so that I can build my schedule
    quickly.
18. As a student, I want the app to use the SunGrid brand (logo, Inter font,
    blue primary color), so that it feels like a polished, purpose-built UCSD
    tool.
19. As a student on the worksheet page, I want the same new navigation bar
    (SunGrid logo, Catalog/Worksheet tabs), so that the app feels consistent
    across pages.

## Implementation Decisions

### Roadmap positioning

This redesign is a new beta slice, independent of Beta-0 UI Surface Cleanup.
Beta-0's scope (removing inherited Yale/CourseTable surfaces without redesigning)
is superseded by this full redesign for the catalog and modal paths. Other
Beta-0 cleanup items (worksheet, profile, etc.) remain valid until those pages
receive their own redesign prototypes.

### Product identity

The product name is **SunGrid**. All user-facing surfaces use this brand. The
logo uses Cormorant Garamond italic for "Sun" and bold for "Grid".

### Data pipeline: Snapshot Availability Data (ADR 0011)

The Catalog Snapshot will include `enrolled`, `capacity`, and `waitlist_count`
per section. These are scraped from UCSD Schedule of Classes HTML at
snapshot-generation time. This supersedes ADR 0004's exclusion of availability
data. Constraints:

- UI must show snapshot timestamp on every surface displaying seat data.
- Seat availability history, real-time polling, demand signals, and
  availability-based filtering remain excluded.

Pipeline changes:

- `scheduleOfClasses.ts`: parse enrolled/capacity/waitlist from HTML table.
- `catalogSnapshot.ts`: remove these fields from the excluded-field validation
  list; add to the section Zod schema.
- `ucsdCatalogSnapshot.ts`: add `enrolled`, `capacity`, `waitlist_count` to
  the `UcsdSection` type.

### Active Planning Term

Switched from S126 (Summer Session I, sparse data) to **SP26** (Spring 2026).
Configured subjects expanded from CSE/MATH to **CSE, MATH, PHYS, ECE** to
cover all Offering Group patterns (LE+DI, LE+LA, LE+DI+LA, LA-only,
Independent Study). `config.ts` `CUR_SEASON` must be updated to `'SP26'`.

### Offering Group: frontend runtime derivation

An **Offering Group** is a UI-layer grouping of sections sharing a Section
Family prefix. It is derived at render time, not stored in the snapshot.

Algorithm (`buildOfferingGroups(sections)`):

1. Group sections by section_code letter prefix (A→"A", B→"B", 001→"").
2. For each family, compare meetings across all sections:
   - **Shared meetings** (identical type+days+time+location across every
     section in the family) → anchor rows (static, not selectable).
   - **Varying meetings** (differ per section) → selectable rows (radio
     selection; each row = one enrollable section).
3. Separator label derived from the varying meeting's type:
   - "Discussion" → "Choose discussion"
   - "Laboratory" → "Choose lab"
4. Single-section families have no selectable rows → direct "Add to Worksheet".
5. Empty-prefix families (numeric codes like "001") → each section is its own
   group.

Validated against all 9 patterns in the SP26 snapshot (25 courses).

### List view row logic

```
families = groupByPrefix(course.sections)

1 family, 1 section     → flat row (section-level info)
1 family, N sections    → flat row (shared lecture info; click opens modal to choose DI/LA)
M families (M > 1)      → expandable parent row
                           badge: "{M} sections"
                           sub-rows: one per family, showing shared lecture meeting
```

### Seats display

| Row type                        | Seats source                                    |
| ------------------------------- | ----------------------------------------------- |
| Flat row (1 family, 1 section)  | That section's enrolled/capacity                |
| Flat row (1 family, N sections) | Aggregated: sum(enrolled) / sum(capacity)       |
| Expandable sub-row (per family) | Family aggregate: sum(enrolled) / sum(capacity) |
| Modal selectable row            | Individual section's enrolled/capacity          |

Color thresholds (percentage = enrolled / capacity):

- ≥ 90%: text `#be123c`, bar `#e8446a` (danger)
- ≥ 60%: text `#33354d`, bar `#1a56db` (filling)
- < 60%: text `#166534`, bar `#22c55e` (available)

### "Add to Worksheet" label

The design's `"Add A00 + A01 to Worksheet"` pattern assumes a separate lecture
section. In UCSD data, Lecture meetings are embedded in each enrollable section.
Adapted to: `"Add A01 to Worksheet"` — the enrollable section code. The
worksheet stores the section_id; that section's meetings already include
shared Lecture/Discussion.

### Filter system

- **Subject** dropdown: maps to `configured_subjects` (CSE, MATH, PHYS, ECE).
- **Course Level** dropdown (replacing Areas/Skills): derived from
  course_number (1–99 = Lower Division, 100–199 = Upper Division, 200+ =
  Graduate). UCSD has no Yale-style areas/skills data; GE mapping is Beta-4.
- **Search**: reuse existing `searchTextMatch.ts` logic (matches code, title,
  instructor, description).
- Active filter chips with remove (×) and reset-all button.

### Design system migration: immediate global swap (方案 A)

Replace `index.css` CSS variables and font stack globally. All pages
(including worksheet, profile, etc. that lack redesign prototypes) inherit the
new tokens immediately. Accepted trade-off: these pages will have "new skin,
old bones" until their prototypes arrive.

Key token changes:

- Primary: `#468ff2` → `#1a56db`
- Font: system sans-serif → Inter + Cormorant Garamond (Google Fonts)
- ~40 new color tokens from the design handoff README

Dark mode: not implemented now. All new tokens should be documented with
placeholder dark-mode values for future implementation.

### React Bootstrap: gradual removal

- New pages (catalog, modal, nav) use pure custom components. No React
  Bootstrap imports.
- Old pages (worksheet, profile, etc.) keep React Bootstrap temporarily.
- Bootstrap global CSS overridden in `index.css` to prevent conflict with new
  tokens.
- `react-bootstrap` dependency removed after the last page is migrated.

### Component architecture: new parallel directories

```
components/
  catalog/                    # New — replaces Search/
    CatalogPage.tsx
    CatalogTable.tsx
    CatalogRow.tsx
    MultiSectionRow.tsx
    FilterBar.tsx
    FilterChip.tsx
  course-modal/               # New — replaces CourseModal/
    CourseModal.tsx
    ModalHeader.tsx
    SectionPills.tsx
    OfferingGroupCard.tsx
    MeetingRow.tsx
    PrerequisitesPanel.tsx
    MetaChips.tsx
  nav/                        # New — replaces Navbar/
    TopNav.tsx
  ui/                         # New — shared primitives
    Button.tsx
    Badge.tsx
    Chip.tsx
    RadioButton.tsx
    DayDots.tsx
    SeatsDisplay.tsx
    FAB.tsx

  # Old directories preserved until worksheet redesign
  Search/
  CourseModal/
  Navbar/
```

Data logic (Zustand slices, hooks, search utilities) stays in existing
locations. New components import from the same `slices/`, `hooks/`, `search/`
modules. No data-layer rewrite.

### State management

Reuse existing slices; extend with new UI state:

- `SearchSlice`: reuse search/filter state. Adapt filter dimensions (add
  course level, keep subject).
- `ModalHistorySlice`: reuse URL param modal routing (`course-modal=`).
- `WorksheetSlice`: reuse add/remove section logic.
- New `CatalogUISlice`: `expandedCourses` (Record<courseId, boolean>),
  `sortColumn`, `sortDirection`.
- New `CourseModalUISlice`: `activeSection`, `selectedDiscussions`
  (Record<familyId, sectionCode | null>), `prereqExpanded`, `activeTab`.

### Virtualization

Skipped for now. SP26 has 25 courses; even with subject expansion to all STEM,
hundreds of courses render fine without virtualization. The variable-height
expand/collapse rows with animations conflict with react-window's fixed
measurement model. When course count exceeds ~500, migrate to
`@tanstack/virtual` (better variable-height support).

### Modal routing

Preserve existing URL query parameter pattern (`?course-modal=<query>`) for
shareability. The new modal component reads from `ModalHistorySlice`.

### Keyboard and accessibility

- Escape closes the modal.
- Focus trap inside the modal when open.
- Radio buttons navigable with arrow keys.
- All interactive elements have `aria-label` attributes.

### Animations

- Modal: `modalFadeIn 0.25s ease-out` (opacity 0→1, scale 0.97→1).
- Backdrop: `backdropFadeIn 0.2s ease-out` (opacity 0→1).
- Chevron rotate: `transition: transform 0.2s`.
- Row hover: `transition: background 0.1s`.
- Card border: `transition: border-color 0.2s`.

## Testing Decisions

### Testing philosophy

Test external behavior at the highest seam possible. Good tests assert what the
user sees or what the next layer receives, not how internal state is structured.

### Key test seams

1. **`buildOfferingGroups()` pure function** — the highest-value seam. Given a
   course's sections array, assert correct family grouping, shared vs varying
   meeting classification, anchor/selectable role assignment, and separator
   labels. Cover all 9 patterns from the SP26 snapshot:
   - Single section, single family (CSE 11)
   - Multi section, single family, selectable Discussion (MATH 3C)
   - Multi section, multi family, selectable Discussion (MATH 10B)
   - Multi section, single family, selectable Laboratory (CSE 8A)
   - Multi section, multi family, selectable Laboratory (CSE 29)
   - Shared Lecture + multiple Discussions + selectable Lab (ECE 35)
   - Lab-only, no shared meetings (PHYS 1AL)
   - Lecture-only, single section (PHYS 1A)
   - Independent Study (MATH 2)

2. **`parseDays()` utility** — day string parsing edge cases (MTWTh, TTh, MW,
   TBA, empty string, lone T → Tuesday).

3. **`formatTime()` utility** — time formatting rules (same AM/PM elision,
   TBA passthrough).

4. **`seatsColor()` utility** — threshold boundary tests (59%, 60%, 89%, 90%,
   100%).

5. **Scraper availability parsing** — given HTML fixture with enrolled/capacity/
   waitlist cells, assert correct field extraction. Extend existing
   `scheduleOfClasses.test.ts`.

6. **Snapshot schema validation** — ensure new section fields pass Zod
   validation. Extend existing `catalogSnapshot.test.ts`.

7. **Browser smoke** — after integration, open `/catalog`, verify table renders,
   click a row to open modal, select a discussion, confirm "Add to Worksheet"
   button appears. Check old pages (worksheet) don't regress.

### Prior art

- `scheduleOfClasses.test.ts` — existing scraper tests with HTML fixtures
- `catalogSnapshot.test.ts` — existing snapshot validation tests
- `generalCatalog.test.ts` — existing catalog parser tests

New pure-function tests (`buildOfferingGroups`, `parseDays`, `formatTime`,
`seatsColor`) should follow the same pattern: input fixture → assert output
shape.

## Out of Scope

- **Worksheet page redesign** — prototype not yet provided. The existing
  worksheet page uses the new global nav and design tokens but retains its
  current layout and React Bootstrap components.
- **Dark mode** — design tokens are documented for future dark-mode
  implementation, but no dark variant is built in this slice.
- **Areas/Skills or GE filtering** — UCSD GE mapping is Beta-4 scope. The
  Areas/Skills dropdown is replaced with Course Level.
- **Past Grades tab content** — the tab button exists in the modal header but
  the content panel is a placeholder. The existing Past Grades (raw Grade
  Archive Records) implementation can be wired in later.
- **Filter dropdown popover internals** — the design notes "not fully
  implemented in prototype." Build as a simple dropdown/popover with
  checkboxes.
- **Real-time availability** — excluded per ADR 0011.
- **Profile, About, FAQ, Login page redesign** — these pages inherit the new
  tokens and font but are not redesigned in this slice.
- **React Bootstrap full removal** — only new pages avoid Bootstrap. Full
  removal happens after all pages are migrated.

## Further Notes

### Design fidelity

The design handoff specifies every color, font size, weight, spacing, radius,
shadow, and interaction as intentional. The full design token table, layout
specs, and interaction matrix are in
`design_handoff_catalog_course_detail/README.md`. The standalone modal file
(`Course Detail Modal-New.dc.html`) is the canonical, more complete modal
design — use it over the simpler modal embedded in the catalog list view
prototype.

### Implementation order

```
Phase 1: Infrastructure
  ├─ Data pipeline (scraper + snapshot schema + frontend types)
  ├─ Config update (CUR_SEASON → SP26, re-generate snapshot)
  ├─ Design system swap (CSS tokens + fonts in index.css)
  └─ ADR 0011 + CONTEXT.md updates  ← DONE

Phase 2: Core components
  ├─ Shared UI primitives (ui/ directory)
  ├─ TopNav (global replacement)
  └─ Utility functions (parseDays, formatTime, seatsColor, buildOfferingGroups)

Phase 3: Catalog List View
  ├─ CatalogPage + FilterBar + CatalogTable
  ├─ CatalogRow + MultiSectionRow
  └─ Wire search/sort/filter to new UI

Phase 4: Course Detail Modal
  ├─ CourseModal + ModalHeader + SectionPills
  ├─ OfferingGroupCard + MeetingRow + PrerequisitesPanel + MetaChips
  └─ State management extensions (CatalogUISlice, CourseModalUISlice)

Phase 5: Integration verification
  ├─ Browser smoke across all interactions
  ├─ Pixel comparison with design prototypes
  └─ Regression check on worksheet and other old pages
```

### UCSD data patterns confirmed (SP26 snapshot)

The SP26 snapshot contains 25 courses across CSE/MATH/PHYS/ECE with
the following confirmed section patterns:

- 8 courses: single section in family, meetings include Lecture + Discussion
- 4 courses: multi section, shared Lecture + Discussion, selectable Laboratory
- 4 courses: multi section, shared Lecture, selectable Discussion
- 1 course: multi family (3), shared Lecture, selectable Discussion (MATH 10B)
- 1 course: multi family (2), shared Lecture + Discussion, selectable Lab (CSE 29)
- 1 course: Lecture only (PHYS 1A)
- 1 course: Lab only, no shared meetings, numeric codes (PHYS 1AL)
- 2 courses: Independent Study
- 1 course: shared Lecture + 2 Discussions, selectable Lab (ECE 35)
- 1 course: multi section, shared Lecture, selectable Discussion, 2 families (MATH 10A)

Key structural insight: UCSD Schedule of Classes does not emit Lecture as a
separate section. The scraper distributes shared Lecture meetings into each
Discussion/Lab section's meetings array. The `buildOfferingGroups` function
must detect shared meetings by comparing across sections within a family,
not by looking for a standalone Lecture section.
