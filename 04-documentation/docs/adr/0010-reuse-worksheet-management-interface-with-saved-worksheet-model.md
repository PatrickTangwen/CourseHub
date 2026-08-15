# Reuse Worksheet Management Interface With Saved Worksheet Model

UCSD Saved Worksheet Management should reuse the familiar CourseTable worksheet
management interface pattern, including the top worksheet selector, create,
rename, delete, and compact Summary layout, but new UCSD product logic must use
the Saved Worksheet model owned by App User ID and Section IDs. We are not
reviving the legacy CourseTable `worksheetNumber`/`netId`/`crn` ownership model,
because that would conflict with the Beta-1 UCSD identity and App DB decisions.

**Considered Options**

- Reuse the existing `WorksheetNumberDropdown` and legacy worksheet APIs
  directly.
- Build a UCSD Saved Worksheet dropdown and management flow that borrows the
  original interface pattern while using `savedWorksheets` APIs.

The second option keeps the user experience familiar without reintroducing Yale
data semantics into the UCSD planner.

**2026-06-22 Interaction Alignment**

After implementation review, the worksheet page should follow the original
CourseTable interaction model more closely: there is one visible worksheet flow,
and authentication changes the persistence backend rather than introducing a
parallel Local Worksheet import panel. Signed-out users edit a browser-local
Main Worksheet persisted in `localStorage`. Signed-in users edit the active
account Saved Worksheet, normally Main Worksheet. The page should not show a
default Local Worksheet save/import prompt after sign-in; copy/import from
browser-local state to account state is future explicit-copy scope.

**UI Reuse Guidance**

Implementation should reuse existing CourseTable UI interaction components,
styling, and behavior wherever they fit the UCSD Saved Worksheet model. New UI
components should be introduced only when the existing interaction is coupled to
legacy worksheet-number APIs, Yale-specific semantics, or unsupported product
surfaces.

**Upstream UI Reference**

When local UCSD code has drifted from original CourseTable behavior, compare
against upstream `coursetable/coursetable` at commit
`efe545aae4767ad460690a45cf323f82dcb0e457`. The most relevant UI references
are:

- `frontend/src/components/Worksheet/NavbarWorksheetSearch.tsx`
- `frontend/src/components/Worksheet/WorksheetNumberDropdown.tsx`
- `frontend/src/components/Worksheet/WorksheetNumberDropdown.module.css`
- `frontend/src/components/Worksheet/WorksheetStatusIcon.tsx`
- `frontend/src/components/Worksheet/WorksheetStats.tsx`
- `frontend/src/components/Worksheet/WorksheetStats.module.css`

Use those files to recover interaction details such as the segmented
Calendar/List/Map header, active term placement, worksheet selector layout,
star/lock icons, inline rename/delete controls, add button placement, and
compact Summary card styling. Treat upstream API and state files as cautionary
context only, because they are coupled to the legacy worksheet-number model.
