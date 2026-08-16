# Beta-1 Saved Worksheet Management

Status: PRD for the next post-auth Saved Worksheet product slice.

Date: 2026-06-22

## Problem Statement

The UCSD planner can save and restore a worksheet for a signed-in user, but the
experience still feels like a validation slice rather than a durable course
planning product. The current UI exposes save and restore as temporary panels,
does not provide the familiar CourseTable worksheet selector pattern, and does
not make the user's active term and active worksheet obvious from the worksheet
page header.

Signed-in users need the planner to behave like a stable account-owned
workspace. They should land in a real Main Worksheet for the active term, create
blank additional Saved Worksheets, rename and delete those worksheets, and have
course add/remove/hide/color changes persist to their account. Signed-out users
should get the same worksheet interaction model, with the same visible
Worksheet/Main Worksheet language, while persistence stays in the current
browser's local storage instead of the account backend.

## Solution

Build `Beta-1 Saved Worksheet Management` as the product hardening slice after
the initial Saved Worksheet save/restore work.

The worksheet page should reuse the familiar CourseTable worksheet-management
interface pattern: `Calendar` and `List` view tabs, a highlighted active term,
and a worksheet dropdown with select, create, rename, and delete actions. The
implementation must use the UCSD Saved Worksheet model, owned by App User ID and
Section IDs, rather than reviving the legacy CourseTable
`worksheetNumber`/`netId`/`crn` model.

For signed-in users, the active supported term should always have a real
term-scoped Main Worksheet. If no Saved Worksheet exists for that user and term,
the worksheet page should create a blank Main Worksheet and make it active.
Creating a new worksheet from the dropdown should create a blank Saved Worksheet
and make it active. Saved Worksheet edits should persist directly to the backend.

For signed-out users, the worksheet remains available and continues to
auto-save in browser local storage. It should not look like a separate product
mode that competes with account Saved Worksheets. After sign-in, the planner
defaults to the account Main Worksheet and does not show a parallel Local
Worksheet import/save prompt. Browser-local state must not automatically switch,
merge, sync, or clear account worksheet state. Importing or copying
browser-local state into an account worksheet is future explicit-copy scope, not
part of this management beta.

## User Stories

1. As a signed-in UCSD planner user, I want to see the active term in the worksheet page header, so that I know which term I am planning.
2. As a signed-in UCSD planner user, I want to see my active Saved Worksheet in the worksheet page header, so that I know where course changes will be saved.
3. As a signed-in UCSD planner user, I want the default worksheet to be called Main Worksheet, so that the planner feels familiar and predictable.
4. As a signed-in UCSD planner user, I want the planner to create a Main Worksheet for the active term if I do not have one, so that I can start planning without setup.
5. As a signed-in UCSD planner user, I want Main Worksheet to be a real account Saved Worksheet, so that course additions persist across browser sessions.
6. As a signed-in UCSD planner user, I want Main Worksheet to be term-scoped, so that my Fall 2026 plan does not mix with another term.
7. As a signed-in UCSD planner user, I want to switch between Calendar and List views, so that I can inspect my worksheet in the layout that fits the task.
8. As a signed-in UCSD planner user, I want the worksheet selector to show all Saved Worksheets for the active term, so that I can choose the plan I want to edit.
9. As a signed-in UCSD planner user, I want to create a blank Saved Worksheet, so that I can start an alternate schedule from scratch.
10. As a signed-in UCSD planner user, I want a newly created blank Saved Worksheet to become active immediately, so that I can begin adding courses to it.
11. As a signed-in UCSD planner user, I want create to mean "blank worksheet", so that it does not unexpectedly copy my Local Worksheet or another Saved Worksheet.
12. As a signed-in UCSD planner user, I want to rename a Saved Worksheet, so that I can label plans by purpose.
13. As a signed-in UCSD planner user, I want to delete an extra Saved Worksheet, so that old experiments do not clutter my account.
14. As a signed-in UCSD planner user, I want the only Saved Worksheet in a term to be protected from deletion, so that I am not left with no active account worksheet.
15. As a signed-in UCSD planner user, I want deleting the active extra worksheet to return me to the term's Main Worksheet, so that I remain in a valid planning state.
16. As a signed-in UCSD planner user, I want the selector to show a star for Main Worksheet, so that I can identify the primary plan quickly.
17. As a signed-in UCSD planner user, I want non-main Saved Worksheets to show as private, so that I understand they are account-owned and not public.
18. As a signed-in UCSD planner user, I do not want public/private sharing controls yet, so that the interface does not imply unsupported sharing behavior.
19. As a signed-in UCSD planner user, I want adding a course from the catalog to target the active Saved Worksheet, so that I do not have to manually save afterward.
20. As a signed-in UCSD planner user, I want removing a course from the worksheet to persist to the active Saved Worksheet, so that reloads preserve my changes.
21. As a signed-in UCSD planner user, I want hiding and showing worksheet sections to persist, so that visibility choices survive refreshes.
22. As a signed-in UCSD planner user, I want color changes to persist, so that visual organization survives refreshes.
23. As a signed-in UCSD planner user, I want the planner to remember my active Saved Worksheet for the current term where practical, so that returning to a term reopens the plan I was using.
24. As a signed-in UCSD planner user, I want the planner to fall back to Main Worksheet if my remembered active worksheet was deleted, so that the page always has a valid target.
25. As a signed-in UCSD planner user, I want switching terms in the future to load that term's active worksheet, so that term-specific planning feels natural.
26. As a signed-in UCSD planner user, I want this beta to preserve the future term-scoped model, so that Beta-2 multi-term support does not require redesigning Saved Worksheet ownership.
27. As a signed-out planner user, I want to keep using the Worksheet with the same add/remove/hide/color controls, so that I can plan before deciding whether to sign in.
28. As a signed-out planner user, I want my worksheet to auto-save in this browser, so that I can return later without an account and continue planning.
29. As a signed-out planner user, I want local add/remove/hide/color actions to stay local, so that I understand they are not account-synced.
30. As a returning signed-in user who previously planned in this browser while signed out, I want the planner to open my account Main Worksheet by default, so that account state remains the primary signed-in experience.
31. As a returning signed-in user who previously planned in this browser while signed out, I do not want a parallel Local Worksheet import prompt to distract from the active account worksheet, so that the page has one clear editing target.
32. As a returning signed-in user who previously planned in this browser while signed out, I do not want automatic merging, syncing, or clearing, so that account worksheets and browser-local storage are not changed unexpectedly.
33. As a returning signed-in user, I want any future copy/import behavior to be introduced as a clearly labeled separate feature, so that Saved Worksheet Management does not imply unsupported migration behavior.
34. As a mobile or narrow-screen planner user, I want the worksheet controls to remain usable without text overflow, so that the core actions work on smaller screens.
35. As a planner user, I want Summary to keep the current compact card visual, so that the worksheet page remains scannable.
36. As a planner user, I want Summary to show only UCSD-supported metrics, so that I am not misled by unavailable workload or rating data.
37. As a planner user, I want Summary not to aggregate Historical GPA into a worksheet-level rating, so that GPA signals remain tied to course/archive context.
38. As a planner user, I want unsupported friends and Add Friend controls to stay hidden, so that the worksheet page does not advertise unavailable social features.
39. As a planner user, I want share URL and ICS export to keep working, so that existing MVP-1 worksheet capabilities are preserved.
40. As a maintainer, I want Saved Worksheet Management to be tested through user-visible behavior, so that the feature can be refactored without breaking tests unnecessarily.

## Implementation Decisions

- Use the domain language in `CONTEXT.md`: Main Worksheet, Saved Worksheet,
  Active Saved Worksheet, Blank Saved Worksheet, browser-local worksheet, App
  User ID, Section ID, and Active Planning Term.
- Respect ADR 0008: account-owned App DB records use internal App User ID, not
  a UCSD email local-part or legacy `netId`.
- Respect ADR 0010: reuse the original CourseTable worksheet-management
  interface pattern while keeping the UCSD Saved Worksheet model separate from
  legacy worksheet-number APIs.
- Reuse the visual and interaction pattern from upstream CourseTable's worksheet
  header and worksheet selector where useful: segmented view tabs, active term
  display, worksheet selector, star/lock icons, inline rename/delete, and a
  bottom create action.
- Do not reuse the legacy CourseTable data semantics:
  `worksheetNumber`/`netId`/`crn` are not the UCSD Saved Worksheet authority.
- Build a UCSD-specific Saved Worksheet selector or management component rather
  than directly extending the legacy worksheet-number dropdown.
- The worksheet page should expose only `Calendar` and `List` view tabs for
  this beta. The inherited `Map`, Friends, and Add Friend controls are not part
  of this slice.
- The active term should be visible next to the view tabs. This beta may expose
  only the current supported Published Snapshot term, but the model must remain
  term-scoped.
- Saved Worksheets are grouped by term. Each supported term should have a Main
  Worksheet for a signed-in user.
- The worksheet page should ensure a blank Main Worksheet exists for the
  signed-in user and active supported term when the page loads.
- Main Worksheet is a real Saved Worksheet, not a synthetic dropdown option.
- The only Saved Worksheet in a term cannot be deleted.
- Additional Saved Worksheets can be created, selected, renamed, and deleted.
- Creating from the worksheet dropdown creates a Blank Saved Worksheet. It does
  not copy the current Local Worksheet or another Saved Worksheet.
- A newly created Blank Saved Worksheet becomes the Active Saved Worksheet.
- Saved Worksheet edits persist directly to the backend. Add, remove, hide, and
  color actions are not local drafts once a Saved Worksheet is active.
- The backend Saved Worksheet API should support term-scoped list, ensure-main
  or equivalent main creation, blank create, detail, rename, delete, and section
  replacement or section mutation for add/remove/hide/color persistence.
- The existing `from-anonymous` route can remain, but it should not be the
  primary Saved Worksheet Management contract.
- Browser-local worksheet state remains the signed-out persistence mode. It
  continues to auto-save to local storage on add/remove/hide/color.
- Signed-out and signed-in users should see the same core worksheet
  interaction shape. The storage backend changes from browser local storage to
  account Saved Worksheet after sign-in.
- After sign-in, the page defaults to the account's Main Worksheet. It should
  not show a default Local Worksheet import/save prompt. No automatic merge,
  sync, or clearing occurs.
- Copying or importing browser-local worksheet state into the account is future
  explicit-copy scope, not part of this Saved Worksheet Management contract.
- Lock icons in this beta are private indicators only. Public/private sharing
  controls are out of scope.
- Summary should keep the current compact card visual. It should show only
  UCSD-supported metrics such as Total courses, Total credits, and Skills &
  Areas where meaningful.
- Summary must not reintroduce CourseTable workload, average rating, friends,
  or demand metrics. It should not create a worksheet-level Average GPA metric.
- Existing Anonymous Worksheet share URL, conflict detection, and ICS export
  behavior should continue to work.

## Testing Decisions

- Test external behavior rather than implementation details. The important
  contract is what users and API clients can do with Saved Worksheets, not the
  internal component names.
- The highest-value seam is the worksheet page behavior under signed-in and
  signed-out states: term-scoped Main Worksheet creation, selector behavior,
  blank create, rename, delete, active worksheet switching, persistent edits,
  browser-local auto-save, and absence of an automatic or default Local
  Worksheet import prompt.
- API/store tests should cover auth requirement, term-scoped list, ensure Main
  Worksheet behavior, blank create, rename, delete, cannot-delete-only-worksheet,
  ownership isolation, and section add/remove/hide/color persistence.
- Frontend tests should cover visible worksheet header state, selector actions,
  signed-in default to Main Worksheet, signed-out Local Worksheet behavior, and
  Summary metric boundaries.
- Existing prior art includes Saved Worksheet route tests, Saved Worksheet
  utility tests, anonymous worksheet local storage tests, and the Saved
  Worksheet acceptance browser smoke.
- Browser smoke should cover login with a development verification code, first
  worksheet page load ensuring Main Worksheet, creating a blank worksheet,
  adding a course to the active Saved Worksheet, reloading or using a fresh
  context to confirm persistence, renaming, deleting an extra worksheet,
  preserving the only Main Worksheet, confirming signed-out browser-local
  worksheet edits still work, and confirming signed-in `/worksheet` shows one
  active account worksheet target without a Local Worksheet import prompt.
- If Playwright is available in the Codex runtime, prefer it for the final
  smoke. If browser automation is blocked by local TLS or session constraints,
  record an equivalent manual smoke using the same path.

## Out of Scope

- Full Beta-2 multi-term support, including adding new Published Snapshots,
  generating Fall 2025 data, term-specific share URL restore, and cross-term UI
  design.
- Copy or duplicate worksheet behavior.
- Automatic import, merge, or sync from Local Worksheet to Saved Worksheet.
- Default Local Worksheet import/save prompts in the signed-in worksheet page.
- Copying browser-local worksheet state into an account Saved Worksheet.
- Clearing browser-local worksheet state after sign-in.
- Public/private sharing controls.
- Friends, friend worksheets, Add Friend, social visibility, and demand counts.
- Wishlist.
- Saved Search hardening.
- Production-like email delivery.
- Google OAuth and Google Calendar direct export.
- Course Data Store or Hasura redesign.
- Subject expansion.
- Availability Data, waitlist, enrollment, open seats, or worksheet demand.
- SET/CAPE or personal UCSD account integration.
- Course modal design changes beyond preserving existing supported behavior.

## Further Notes

- Upstream CourseTable's current worksheet-management UI is useful as an
  interface reference, but its core model is legacy `netId + season +
worksheetNumber + crn`. The UCSD planner should borrow the interaction shape,
  not the data authority.
- UI interaction reuse is preferred. Implementation should reuse existing
  CourseTable components, styling, and interaction patterns wherever they fit
  the UCSD Saved Worksheet model. Build new UCSD-specific UI only when reuse
  would force legacy worksheet-number APIs, Yale-specific semantics, or
  unsupported product surfaces back into the planner.
- When local UCSD code has drifted from original CourseTable behavior, compare
  against upstream `coursetable/coursetable` at commit
  `efe545aae4767ad460690a45cf323f82dcb0e457`. Relevant UI references are:
  `frontend/src/components/Worksheet/NavbarWorksheetSearch.tsx`,
  `frontend/src/components/Worksheet/WorksheetNumberDropdown.tsx`,
  `frontend/src/components/Worksheet/WorksheetNumberDropdown.module.css`,
  `frontend/src/components/Worksheet/WorksheetStatusIcon.tsx`,
  `frontend/src/components/Worksheet/WorksheetStats.tsx`, and
  `frontend/src/components/Worksheet/WorksheetStats.module.css`. Reuse those
  interaction details where they fit the UCSD Saved Worksheet model; treat
  upstream API/state files as cautionary context only because they are coupled
  to legacy worksheet-number behavior.
- Suggested execution split:
  1. Backend Saved Worksheet Management API.
  2. Worksheet Top Bar Management UI.
  3. Saved Worksheet Editing Persistence.
  4. Summary Restyle and Acceptance Smoke.
- Current repo state before this PRD: `main` had no open GitHub issues, and the
  previous Saved Worksheet save/restore PRD and acceptance work were complete.
