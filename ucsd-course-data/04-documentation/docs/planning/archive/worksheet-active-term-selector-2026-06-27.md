# Worksheet Active Term Selector (Anonymous)

Status: PRD for the anonymous Worksheet term-selector slice.

Date: 2026-06-27

## Problem Statement

A signed-out (Anonymous Worksheet) user on desktop has no term selector anywhere
on the Worksheet page. When they switch the Catalog to a term and add a course,
the section is correctly routed into that term's worksheet set, but the Worksheet
page stays on its default Worksheet Viewed Term (`CUR_SEASON`) with no visible
affordance to switch. The course "disappears": it looks like the add did not work
when in fact it landed in another term's worksheet.

The data model is already correct and term-keyed; this is a missing-signal / missing-affordance gap, not a model defect:

- Anonymous worksheets are stored per-term-keyed as `coursesByTerm: { [term]: [...] }`
  in `frontend/src/utilities/anonymousWorksheet.ts`. Adds use the course's own
  `season_code`, not the viewed term, so cross-term adds are already routed
  correctly and silently.
- The desktop navbar renders a term/worksheet selector only for legacy and saved
  accounts; the anonymous branch falls through to `null`
  (`frontend/src/components/Worksheet/NavbarWorksheetSearch.tsx`).
- The page-body `SeasonDropdown` is gated by `isMobile && !isAnonymousWorksheet`
  (`frontend/src/pages/Worksheet.tsx`), so it never renders for anonymous users on
  either desktop or mobile.
- `viewedSeason` is initialized to a hard-coded `CUR_SEASON`
  (`frontend/src/slices/WorksheetSlice.ts`) and is not hydrated from the persisted
  `anonymousWorksheet.term`, so a manual term choice is lost on a full page reload.

The MVP-1 default user is exactly this signed-out user, so the gap is on the
primary path.

## Solution

Surface the existing per-term worksheet model to Anonymous Worksheet users by
rendering the worksheet term selector for them, and make the term they are
viewing obvious and stable. Adding a course stays silent; discoverability comes
from the selector and the empty-state at view time, not from auto-switching or
add-time notifications.

The control model is manual, sticky, and independent of the Catalog:

- The Worksheet Viewed Term is chosen through the selector and defaults to the
  most recent Supported Term.
- It is independent of the term the Catalog is browsing. Switching the Catalog
  term never moves it.
- It persists across navigation between Catalog and Worksheet (already true
  in-session via the store) and across a full page reload (new: hydrate from the
  stored worksheet term).
- It is never silently reassigned by adding a section from another term.

Signal that closes the "looks like it did not get added" gap, at view time:

- An empty Worksheet Viewed Term shows a variant-aware empty state that points to
  the terms holding courses. The term selector itself shows plain term names (no
  per-term count).

This slice covers Anonymous Worksheet only. Unifying signed-in Saved Worksheet
accounts to the same cross-term behavior is deferred (see Out of Scope).

## User Stories

1. As a signed-out planner user on desktop, I want a term selector on the Worksheet page, so that I can see and switch which term's worksheet I am viewing.
2. As a signed-out planner user, I want the selector to list all Supported Terms, so that I can plan any available term.
3. As a signed-out planner user, I want the selector to show how many courses each term holds, so that I can tell at a glance where my courses are.
4. As a signed-out planner user who added a course for another term, I want an empty term's worksheet to tell me which terms hold my courses and let me jump there, so that I am not left thinking the add failed.
5. As a signed-out planner user, I want adding a course to stay silent and route to its own term, so that adding feels seamless and does not interrupt my catalog browsing.
6. As a signed-out planner user, I want the term I picked to stay selected when I move between Catalog and Worksheet, so that I am not bounced back to the default term.
7. As a signed-out planner user, I want the term I picked to survive a page reload, so that returning to the planner reopens the term I was planning.
8. As a signed-out planner user, I do not want the Worksheet term to follow the Catalog term, so that my worksheet view stays where I left it.
9. As a brand-new signed-out planner user with no courses anywhere, I want a plain "add courses from the Catalog" empty state, so that I am not shown a confusing "your courses are in …" prompt with nothing to list.
10. As a signed-out planner user, I want a term with only hidden courses to still be shown as holding courses, so that hiding a section does not make the term look empty.
11. As a signed-out planner user on mobile, I want the same term selector behavior, so that the experience matches desktop.

## Implementation Decisions

- Use the domain language in `CONTEXT.md`: Worksheet, Worksheet Viewed Term,
  Anonymous Worksheet, Supported Term, Section, `viewedSeason`.
- Default the Worksheet Viewed Term to the most recent Supported Term (current
  `CUR_SEASON` behavior). Do not auto-resolve to a non-empty term or to the
  last-added term.
- Keep the Worksheet Viewed Term manual, sticky, and independent of the Catalog
  term. Adding a section from another term never reassigns it.
- Keep adding a course silent for anonymous users (no toast). Adds continue to
  route into `coursesByTerm[season_code]`.
- Render the term selector for anonymous users:
  - Desktop: replace the `null` anonymous branch in
    `NavbarWorksheetSearch.tsx` with `SeasonDropdown` (desktop variant).
  - Mobile: drop the `!isAnonymousWorksheet` gate on `SeasonDropdown` in
    `Worksheet.tsx`. Do not render `WorksheetNumDropdown` for anonymous users;
    there is no worksheet-number concept for an Anonymous Worksheet.
- Hydrate the initial `viewedSeason` from the persisted `anonymousWorksheet.term`
  in `WorksheetSlice.ts`, falling back to `CUR_SEASON`, so the manual term choice
  survives a full reload.
- Selector contents and labels:
  - List all Supported Terms via the existing `useWorksheetSeasonCodes` source.
  - Use term-only labels (CourseTable-faithful). Drop the `Season` button word so
    the trigger shows just the term (e.g. `Fall 2024`), with no per-term count.
- Discovery semantics: a term is treated as holding courses when its set has any
  section, hidden included. Hiding is a calendar display toggle, not a removal,
  so a term with only hidden courses still appears as non-empty in the empty-state
  pointer.
- Variant-aware empty state for the Worksheet Viewed Term:
  - Courses-elsewhere variant: when the viewed term is empty but other terms hold
    courses, show "this term's worksheet is empty" plus clickable term chips
    ("Fall 2024 (3)", "Spring 2026 (1)") that switch the Worksheet Viewed Term.
  - Empty-everywhere variant: when no term holds courses, show the generic "your
    worksheet is empty; add courses from the Catalog" message.
  - Cover both calendar and list views.
- Reuse the existing `SeasonDropdown` component and `changeViewedSeason` action
  rather than building a new selector.

## Testing Decisions

- Test external, user-visible behavior rather than component internals.
- Highest-value seam is the anonymous Worksheet page across term states:
  - The term selector renders for anonymous users on desktop and mobile.
  - Switching the selector changes the Worksheet Viewed Term and the rendered
    course set.
  - Adding a course for a non-viewed term leaves the viewed term unchanged and
    shows no toast, and the course appears in the target term's worksheet.
  - The viewed term persists across Catalog/Worksheet navigation and a full
    reload, and is not changed by switching the Catalog term.
  - The selector lists all Supported Terms as plain term names.
  - The empty state shows the courses-elsewhere variant with working term chips
    when other terms hold courses, and the generic variant when none do.
- Prior art to extend: anonymous worksheet local-storage tests
  (`anonymousWorksheet`), `WorksheetSlice` tests, and any worksheet page tests.
- If browser automation is available, add a smoke: catalog at term A, add a
  course, open Worksheet defaulting to the latest term, observe the empty-state
  prompt and count, switch to term A, confirm the course, reload, confirm the
  term choice persists.

## Out of Scope

- Unifying signed-in Saved Worksheet accounts to silent cross-term routing. Saved
  accounts are currently single-term-locked to `CUR_SEASON` with no term switcher
  and block cross-term adds with an error. Giving them the same behavior is a
  separate, larger slice that builds full multi-term Saved Worksheet support
  (term switcher replacing the static term badge, cross-term add routing,
  writing a non-active worksheet, cross-term catalog toggle membership, the
  and empty state). It needs its own ADR extending ADR 0010 and should be grilled
  on its own. Tentative direction already captured for that slice: a cross-term
  add targets the term's remembered active worksheet, falling back to that term's
  Main Worksheet, creating one via `ensureMainSavedWorksheetForTerm` if none
  exists.
- Auto-switching the Worksheet Viewed Term to the term of a just-added course.
- Add-time toasts or notifications for anonymous adds.
- Legacy worksheet-number account behavior changes beyond inheriting the shared
  `SeasonDropdown` label tweak.
- Any change to the per-term storage shape or the catalog add routing logic.

## Further Notes

- No ADR is created for this slice. The "manual, sticky, no auto-switch,
  discoverability via the empty-state pointer" decision is reversible UI
  behavior, and the model is captured by the new `Worksheet Viewed Term` entry in
  `CONTEXT.md`. The Saved Worksheet multi-term unification, by contrast, changes
  backend write behavior and will warrant an ADR when that slice is built.
- This slice does not violate ADR 0010's single-term-bound Saved Worksheet model;
  it only concerns Anonymous Worksheet view state.
- Root-cause references for implementation:
  - `frontend/src/pages/Worksheet.tsx` (mobile dropdown gating)
  - `frontend/src/components/Worksheet/NavbarWorksheetSearch.tsx` (desktop
    anonymous `null` branch)
  - `frontend/src/components/Worksheet/SeasonDropdown.tsx` (selector component,
    term source, labels)
  - `frontend/src/slices/WorksheetSlice.ts` (`viewedSeason` init and
    `changeViewedSeason` persistence)
  - `frontend/src/utilities/anonymousWorksheet.ts` (`coursesByTerm` storage shape)
- Suggested execution split:
  1. Render `SeasonDropdown` for anonymous (desktop navbar + mobile page body)
     and hydrate `viewedSeason` from storage.
  2. Drop the `Season` label so the selector shows plain term names.
  3. Add the variant-aware empty state with term-switch chips.
