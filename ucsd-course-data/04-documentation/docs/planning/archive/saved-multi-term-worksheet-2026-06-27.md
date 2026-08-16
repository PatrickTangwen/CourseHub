# Saved Multi-Term Worksheet (Signed-In)

Status: PRD for the signed-in multi-term Saved Worksheet slice.

Date: 2026-06-27

## Problem Statement

Signed-in Saved Worksheet accounts are effectively single-term-locked, while the
companion Anonymous Worksheet slice gives signed-out users full per-term
navigation. The divergence is on the signed-in path:

- The worksheet page only ever bootstraps `ensureMainSavedWorksheetForTerm(CUR_SEASON)`
  (`frontend/src/pages/Worksheet.tsx`), so the active term never changes from the
  current season.
- The signed-in header shows the active term as a static badge with no term
  switcher; only a worksheet-name dropdown exists, scoped to that one term
  (`frontend/src/components/Worksheet/NavbarWorksheetSearch.tsx`).
- Adding a catalog section whose term differs from the active Saved Worksheet is
  rejected with an error in `getActiveSavedWorksheetSectionId`
  (`frontend/src/slices/WorksheetSlice.ts`), instead of being routed to the right
  term like an Anonymous Worksheet add.

The result is that a signed-in user cannot view, switch to, or add to any term
other than the current season, and a cross-term add looks like a failure. This
slice brings signed-in accounts to behavioral parity with Anonymous Worksheets,
established by ADR 0015, without changing the single-term-bound Saved Worksheet
model of ADR 0010.

This is a frontend-only slice. The existing Saved Worksheet API is sufficient:

- `GET /api/savedWorksheets` (no `term` param) returns all of a user's worksheet
  summaries across all terms in one call, each with `sectionCount`, so deriving
  which terms hold courses is cheap.
- `POST /api/savedWorksheets/:id/sections` (`updateSavedWorksheetSections`) writes
  any worksheet the user owns by id, so a non-active worksheet can be updated
  without activating it.
- `POST /api/savedWorksheets/ensure-main` and `GET /api/savedWorksheets/:id`
  cover on-demand Main creation and full-section loading.

## Solution

Give signed-in users the same per-term worksheet experience as Anonymous
Worksheets, using the Saved Worksheet model.

Replace the static active-term badge with a term selector paired with the
existing worksheet-name selector (two dropdowns, matching the original
CourseTable shape and the Anonymous Worksheet term selector). The term selector
lists all Supported Terms, and switching terms bootstraps that term and lands on
its Active Saved Worksheet.

Resolve "the relevant worksheet for a term" with one rule, the term's Active
Saved Worksheet: the remembered active worksheet for that term
(`activeSavedWorksheetIdsByTerm`), else that term's Main Worksheet, else a Main
Worksheet created on demand. This single rule governs the cross-term add target,
the catalog toggle membership for a section, and which worksheet a term switch
lands on.

Adding a catalog section whose term differs from the viewed term routes silently
into that term's Active Saved Worksheet rather than erroring. The view does not
switch and the target worksheet is not activated. Discoverability is at view
time: a variant-aware empty state that points to the terms holding courses.

## User Stories

1. As a signed-in planner user, I want a term selector in the worksheet header, so that I can switch which term's worksheet I am viewing.
2. As a signed-in planner user, I want the term selector to list all Supported Terms, so that I can start planning any available term.
3. As a signed-in planner user, I want to discover which other terms hold my courses without checking each one by hand, so that a cross-term add is never lost.
4. As a signed-in planner user, I want switching terms to land me on the worksheet I last used in that term, so that I return to where I was planning.
5. As a signed-in planner user, I want switching to a never-visited term to open a Main Worksheet for it, so that I can start planning without a setup step.
6. As a signed-in planner user, I want the worksheet-name dropdown to keep managing the multiple worksheets within the current term, so that term switching and worksheet switching stay separate, predictable controls.
7. As a signed-in planner user who adds a course for another term, I want it to land in that term's active worksheet instead of being rejected, so that adding feels seamless and correct.
8. As a signed-in planner user, I want a cross-term add to leave my current view unchanged, so that adding does not yank me through a loading view mid-browse.
9. As a signed-in planner user, I want the catalog add/remove button for a course to reflect whether it is in that course's term worksheet, so that the button state is accurate across terms.
10. As a signed-in planner user, I want an empty term's worksheet to tell me which other terms hold my courses and let me jump there, so that a cross-term add never looks like it failed.
11. As a brand-new signed-in planner user with no courses anywhere, I want a plain "add courses from the Catalog" empty state, so that I am not shown a misleading "your courses are in …" prompt.
12. As a signed-in planner user, I want a cross-term add to confirm against the backend before the button flips, so that the button never claims "added" for a write that did not persist.
13. As a signed-in planner user, I want a failed cross-term add to revert and tell me which term it tried to use, so that I am not left with a false "added" state on an off-screen worksheet.
14. As a returning signed-in planner user, I want to reopen the term I last viewed, so that I am not always bounced back to the current season.
15. As a signed-in planner user, I want the worksheet term to stay independent of the Catalog term, so that browsing the catalog does not move my worksheet view.
16. As a maintainer, I want this slice to need no backend or schema changes, so that it ships as a frontend change against the existing Saved Worksheet API.

## Implementation Decisions

- Use the domain language in `CONTEXT.md`: Worksheet Viewed Term, Active Saved
  Worksheet, Main Worksheet, Saved Worksheet, Supported Term, Section ID. Respect
  ADR 0010 (single-term-bound Saved Worksheet model) and follow ADR 0015.
- Behavioral north star is parity with the Anonymous Worksheet term selector:
  silent cross-term routing, no view switch, discoverability at view time.
- Resolution rule for a term's Active Saved Worksheet: remembered active
  (`activeSavedWorksheetIdsByTerm[term]`) → that term's Main Worksheet → a Main
  Worksheet created on demand via `ensureMainSavedWorksheetForTerm`. This one rule
  governs the cross-term add target, catalog toggle membership, and the
  term-switch landing worksheet.
- Term selector UI: replace the static term badge in
  `SavedWorksheetHeaderControlsView` with a term dropdown, kept alongside the
  worksheet-name dropdown (two dropdowns). The term dropdown lists all Supported
  Terms as plain term names (no per-term count). Switching a term calls
  `ensureMainSavedWorksheetForTerm(term)` and lands on the resolved Active Saved
  Worksheet. Reuse the Anonymous Worksheet term-dropdown shape where it fits; the
  selection action is account-aware (anonymous changes `viewedSeason`; signed-in
  bootstraps the term's Saved Worksheet).
- Verified current-state notes for the term control:
  - The active-term badge is a single shared header component
    (`SavedWorksheetHeaderControlsView`) rendered on both mobile and desktop, so
    replacing it covers both viewports in one place.
  - `viewedSeason` is already kept in sync with the active Saved Worksheet's term
    when a worksheet is activated, so the selector reads the current term from
    existing state. But `changeViewedSeason` only sets `viewedSeason` / writes
    anonymous local storage and does not load a Saved Worksheet; the signed-in
    term switch must route through `ensureMainSavedWorksheetForTerm`, not
    `changeViewedSeason`, or the view desyncs from the loaded worksheet.
  - A mobile-only page-body season dropdown and a legacy worksheet-number
    dropdown currently also render for signed-in accounts. The new term selector
    must be the single term control: reconcile these so a signed-in account has
    no duplicate or out-of-sync term controls on mobile and the legacy
    worksheet-number dropdown does not drive the saved term.
- Cross-term add: replace the rejection in `getActiveSavedWorksheetSectionId`
  with routing. Add a write path that updates a non-active worksheet by id
  (`updateSavedWorksheetSections`) without activating it, after loading that
  worksheet's current sections. The catalog toggle evaluates membership against
  the section's term Active Saved Worksheet, and remove operates on the same
  target.
- Writes are confirmed (non-optimistic), matching existing Saved Worksheet add
  behavior: the catalog toggle flips only after the backend write succeeds. A
  successful cross-term add is silent; a failed one reverts to
  "not added" and shows an error toast naming the target term.
- Which terms hold courses comes from one `fetchSavedWorksheets()` (no term) call
  returning all summaries with `sectionCount`. A term counts as holding courses
  when its resolved Active Saved Worksheet has sections (hidden included). Refresh
  the all-terms summaries on bootstrap and after any cross-term write so the empty
  state stays accurate.
- Empty state is variant-aware and cross-term only: when the viewed term's Active
  Saved Worksheet is empty but other terms hold courses, list those other terms
  as clickable term switches; when no term holds courses, show the
  generic "add from the Catalog" state. Another worksheet within the same term is
  surfaced by the worksheet-name dropdown, not the empty state. Cover calendar and
  list views.
- Remember the last viewed term client-side (localStorage) and bootstrap it on
  load instead of the hard-coded `CUR_SEASON`, falling back to `CUR_SEASON` if the
  remembered term is no longer a Supported Term. Keep the Worksheet Viewed Term
  independent of the Catalog term.
- No backend, route, or schema changes. The existing Saved Worksheet endpoints
  (list-all-with-`sectionCount`, ensure-main, update-sections-by-id, get-by-id,
  create-blank, rename, delete) are sufficient.

## Testing Decisions

- Test external, user-visible behavior rather than component internals.
- Highest-value seam is the signed-in worksheet page across terms:
  - The term selector renders and lists all Supported Terms as plain term names.
  - Switching terms bootstraps the term and lands on the resolved Active Saved
    Worksheet (remembered active → Main → created on demand).
  - A cross-term catalog add routes into the section's term Active Saved
    Worksheet, leaves the viewed term unchanged, flips the toggle only after the
    write, and is silent on success.
  - A failed cross-term add reverts and shows an error toast naming the term.
  - The catalog toggle reflects membership in the section's term worksheet, and
    remove operates on that worksheet.
  - The viewed term persists across reload (fallback to `CUR_SEASON` when
    unsupported) and is not changed by switching the Catalog term.
  - The empty state shows the cross-term variant with working term switches when
    other terms hold courses, and the generic variant when none do.
- Store/slice tests should cover the resolution rule, non-active worksheet writes,
  on-demand Main creation, which-terms-hold-courses derivation, and
  last-viewed-term persistence. Extend the existing `WorksheetSlice`
  saved-worksheet tests.
- If browser automation is available, add a smoke: sign in, land on the last
  viewed term, switch terms via the new dropdown, add a course for a different
  term from the catalog, confirm the viewed term is unchanged and the target
  term's count increments, switch to that term to see the course, reload to
  confirm the term persists, and confirm a simulated write failure reverts with a
  term-named toast.

## Out of Scope

- Any backend, route, or database schema change. This slice is frontend-only.
- A new aggregated endpoint for cross-term discovery; the existing no-term
  summaries call is used instead.
- Server-side persistence of the last viewed term; it is remembered client-side.
- Auto-switching the view to a cross-term add's term, or add-time success toasts.
- Surfacing same-term other-worksheet contents in the empty state; that stays the
  worksheet-name dropdown's job.
- Changing the single-term-bound Saved Worksheet model, Main Worksheet
  protection, rename/delete rules, or sharing/privacy controls (ADR 0010).
- Copy/import/merge between Anonymous and Saved Worksheets.
- Legacy worksheet-number account behavior.
- Friends, demand counts, wishlist, Saved Search hardening, availability data.

## Further Notes

- This slice is recorded by ADR 0015, which extends ADR 0010 without changing the
  single-term Saved Worksheet model. The companion Anonymous Worksheet term
  selector is in `docs/planning/archive/worksheet-active-term-selector-2026-06-27.md`.
- Key references for implementation:
  - `frontend/src/pages/Worksheet.tsx` (CUR_SEASON-only bootstrap)
  - `frontend/src/components/Worksheet/NavbarWorksheetSearch.tsx`
    (`SavedWorksheetHeaderControlsView`, static term badge)
  - `frontend/src/components/Worksheet/SeasonDropdown.tsx` (anonymous term
    dropdown shape to reuse)
  - `frontend/src/slices/WorksheetSlice.ts`
    (`getActiveSavedWorksheetSectionId` cross-term rejection,
    `addActiveSavedWorksheetListing`, `ensureMainSavedWorksheetForTerm`,
    `replaceActiveSavedWorksheetSections`, `activeSavedWorksheetIdsByTerm`)
  - `frontend/src/queries/api.ts` (`fetchSavedWorksheets`,
    `fetchSavedWorksheet`, `updateSavedWorksheetSections`,
    `ensureMainSavedWorksheet`)
- Suggested execution split:
  1. Term selector UI: replace the badge with an account-aware term dropdown,
     wire term switch to `ensureMainSavedWorksheetForTerm`, and remember the last
     viewed term across reload.
  2. Cross-term add routing: replace the rejection with target resolution and a
     non-active write path; make the catalog toggle term-aware.
  3. The variant-aware cross-term empty state, refreshed from the all-terms
     summaries.
